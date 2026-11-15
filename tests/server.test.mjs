import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { importData, legacySnapshot } from '../server/import.js';
import { ingestObservation, fromFleetData } from '../server/observations.js';
import { Vault, TeslaAuth } from '../server/vault.js';
import { Poller } from '../server/poller.js';
import { createApp } from '../server/app.js';
import { configFromEnv } from '../server/config.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/demo-snapshot.json',import.meta.url)));
const at=Date.parse('2026-10-01T00:00:00Z');
function setup(t,extra={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quagoev-test-'));
 const config={dataDir:dir,accessToken:'unit-test-only-access-key-000000000000000',vaultKey:'ab'.repeat(32),mode:'paused',limit:8,billingVerified:false,pollSeconds:180,fleetApi:'https://fleet-api.prd.na.vn.cloud.tesla.com',...extra};
 const store=new Store(dir,config);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,config,dir};
}
const obs=(time,state,extra={})=>({eventId:`sample-${time}-${state}`,vehicleId:'test-car',observedAt:time,state,batteryLevel:80,odometerKm:100,...extra});

test('legacy migration converts miles and seconds; marks unknown car and estimates',t=>{
 const {store}=setup(t);const old={trips:[{id:'a',startTime:at/1000,endTime:at/1000+600,distance:10,energyUsed:2,startBattery:80,endBattery:77}],chargeSessions:[{id:'c',startTime:at,endTime:at+60000,energyAdded:3,locationType:'home'}]};
 assert.equal(importData(store,'legacy',old),true);assert.equal(importData(store,'legacy',old),false);
 const s=store.snapshot();assert.equal(s.trips.length,1);assert.equal(s.trips[0].startTime,at);assert.equal(s.trips[0].distanceKm,16.09344);assert.equal(s.trips[0].energySource,'legacy-estimate');assert.equal(s.charges[0].locationType,'unknown');assert.equal(s.charges[0].cost,null);
});
test('invalid import is atomic and preserves previously edited data',t=>{
 const {store}=setup(t);importData(store,'snapshot',fixture);const id=fixture.trips[0].id;store.editRecord('trips',id,{notes:'My note'});
 const invalid=structuredClone(fixture);invalid.trips.push({...invalid.trips[0],id:'bad',vehicleId:'missing'});assert.throws(()=>importData(store,'snapshot',invalid));
 assert.equal(store.records('trips').length,fixture.trips.length);assert.equal(store.record('trips',id).notes,'My note');
 importData(store,'snapshot',{...fixture,revision:2});assert.equal(store.record('trips',id).notes,'My note');
});
test('full data backup restores counts and never imports server identity or budget',t=>{
 const {store}=setup(t);importData(store,'snapshot',fixture);const snapshot=store.snapshot();assert.notEqual(snapshot.serverId,fixture.serverId);assert.equal(snapshot.collector.mode,'paused');
 const second=fs.mkdtempSync(path.join(os.tmpdir(),'quagoev-restore-'));const restored=new Store(second);try{importData(restored,'snapshot',snapshot);assert.equal(restored.records('trips').length,snapshot.trips.length);assert.equal(restored.records('charges').length,snapshot.charges.length);}finally{restored.close();fs.rmSync(second,{recursive:true,force:true});}
});
test('budget reservation persists, rejects over-limit and resets monthly without races',t=>{
 const {store}=setup(t,{limit:.004});assert.equal(store.reserveUsage({requests:1},at),true);assert.equal(store.reserveUsage({requests:1},at),true);assert.equal(store.reserveUsage({requests:1},at),false);assert.equal(store.usage(at).requests,2);
 assert.equal(store.reserveUsage({requests:1},Date.parse('2026-11-01T00:00:00Z')),true);
});
test('replaying or out-of-order observations does not duplicate or regress history',t=>{
 const {store}=setup(t);const o=obs(at,'parked');assert.equal(ingestObservation(store,o),true);assert.equal(ingestObservation(store,o),false);
 assert.equal(ingestObservation(store,obs(at-1000,'driving')),false);assert.equal(store.vehicle('test-car').latest.state,'parked');
});
test('drive state persists across server restart and energy is unknown without a capacity',t=>{
 const {store,dir}=setup(t);ingestObservation(store,obs(at,'parked'));ingestObservation(store,obs(at+60000,'driving'));
 const reopened=new Store(dir);try{ingestObservation(reopened,obs(at+120000,'driving',{odometerKm:105,batteryLevel:78}));ingestObservation(reopened,obs(at+180000,'parked',{odometerKm:110,batteryLevel:76}));assert.equal(reopened.records('trips')[0].distanceKm,10);assert.equal(reopened.records('trips')[0].energyKwh,null);assert.equal(reopened.records('trips')[0].incomplete,false);}finally{reopened.close();}
});
test('configured pack capacity yields labelled estimates, not hardcoded energy',t=>{
 const {store}=setup(t);store.editSettings({batteryCapacityKwh:60});ingestObservation(store,obs(at,'driving'));ingestObservation(store,obs(at+60000,'parked',{batteryLevel:75,odometerKm:120}));const trip=store.records('trips')[0];assert.equal(trip.energyKwh,3);assert.equal(trip.energySource,'estimated');
});
test('unknown/offline readings close incomplete trips at last valid point',t=>{
 const {store}=setup(t);ingestObservation(store,obs(at,'driving'));ingestObservation(store,obs(at+60000,'driving',{odometerKm:104}));ingestObservation(store,{eventId:'lost',vehicleId:'test-car',observedAt:at+120000,state:'offline'});
 const trip=store.records('trips')[0];assert.equal(trip.distanceKm,4);assert.equal(trip.endTime,at+60000);assert.equal(trip.incomplete,true);assert.equal(store.vehicle('test-car').latest.state,'offline');
});
test('gap splits a drive without inventing distance through missing observations',t=>{
 const {store}=setup(t);ingestObservation(store,obs(at,'driving'));ingestObservation(store,obs(at+60000,'driving',{odometerKm:102}));ingestObservation(store,obs(at+3600000,'driving',{odometerKm:180}));ingestObservation(store,obs(at+3660000,'parked',{odometerKm:182}));assert.equal(store.records('trips').length,2);assert.equal(store.records('trips').reduce((n,t)=>n+t.distanceKm,0),4);assert.ok(store.records('trips').every(t=>t.incomplete));
});
test('unplug resetting charge counter keeps last measured charge energy',t=>{
 const {store}=setup(t);ingestObservation(store,obs(at,'charging',{chargeEnergyKwh:0,chargerPowerKw:7}));ingestObservation(store,obs(at+60000,'charging',{chargeEnergyKwh:5,chargerPowerKw:11}));ingestObservation(store,obs(at+120000,'parked',{chargeEnergyKwh:0}));const c=store.records('charges')[0];assert.equal(c.energyKwh,5);assert.equal(c.maxPowerKw,11);assert.equal(c.locationType,'unknown');
});
test('tariffs apply only to confirmed home charging and actual costs remain unchanged',t=>{
 const {store}=setup(t);importData(store,'snapshot',fixture);const id=fixture.charges[0].id;store.editRecord('charges',id,{cost:null,ratePerKwh:null,locationType:'unknown'});store.editSettings({homeRatePerKwh:.3});assert.equal(store.snapshot().charges.find(c=>c.id===id).cost,null);store.editRecord('charges',id,{locationType:'home'});assert.equal(store.snapshot().charges.find(c=>c.id===id).cost,Math.round(fixture.charges[0].energyKwh*.3*100)/100);store.editRecord('charges',id,{cost:3});store.editSettings({homeRatePerKwh:.4});assert.equal(store.snapshot().charges.find(c=>c.id===id).cost,3);
});
test('Tesla OAuth requests data/location only and refresh operations are serialized',async t=>{
 const {dir,config}=setup(t);const vault=new Vault(dir,config.vaultKey);let calls=0;
 const auth=new TeslaAuth({...config,clientId:'test-id',clientSecret:'test-secret',redirectUri:'http://localhost:3001/auth/callback'},vault,async()=>{calls++;await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({access_token:'new',refresh_token:'refresh',expires_in:3600}),{status:200});});
 const scopes=new URL(auth.loginUrl()).searchParams.get('scope');assert.ok(scopes.includes('vehicle_device_data'));assert.ok(!scopes.includes('vehicle_cmds'));assert.ok(!scopes.includes('vehicle_charging_cmds'));
 vault.write({access_token:'old',refresh_token:'refresh',expires_at:0});await Promise.all([auth.token(),auth.token()]);assert.equal(calls,1);assert.equal(await auth.token(),'new');assert.ok(!fs.readFileSync(vault.path,'utf8').includes('refresh'));
});
test('poller never calls Tesla while paused or allowance not verified',async t=>{
 const {store,config}=setup(t);let calls=0;const auth={ready:()=>true,token:async()=>{calls++;return 'test';}};
 for(const cfg of [config,{...config,mode:'polling'}]){const poller=new Poller(cfg,store,auth,async()=>{calls++;});await poller.poll();poller.start();poller.stop();}assert.equal(calls,0);
});
test('poller checks budget before network and does not wake a sleeping vehicle',async t=>{
 const {store,config}=setup(t,{mode:'polling',billingVerified:true,limit:.002});const paths=[];
 const poller=new Poller(config,store,{ready:()=>true,token:async()=>'test'},async(url,options)=>{paths.push(url);assert.equal(options.method,undefined);return new Response(JSON.stringify({response:[{vin:'test-car',display_name:'Car',state:'asleep'}]}));});await poller.poll();await poller.poll();assert.equal(paths.length,1);assert.equal(store.collector.status,'budget_paused');assert.equal(store.vehicle('test-car').latest.state,'asleep');
});
test('API requires app key, serves saved history with expired Tesla auth, has no car controls',async t=>{
 const {store,config}=setup(t);importData(store,'snapshot',fixture);let externalCalls=0;
 const app=createApp({config,store,auth:{ready:()=>false,loginUrl:()=>{externalCalls++;return 'invalid';}}});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;const headers={Authorization:`Bearer ${config.accessToken}`};
 assert.equal((await fetch(`${base}/api/v2/snapshot`)).status,401);const response=await fetch(`${base}/api/v2/snapshot`,{headers});assert.equal(response.status,200);assert.equal((await response.json()).trips.length,fixture.trips.length);
 for(const action of ['wake','command/door_unlock','command/charge_start'])assert.equal((await fetch(`${base}/api/vehicles/1/${action}`,{method:'POST',headers})).status,404);
 assert.equal(externalCalls,0);const backup=await (await fetch(`${base}/api/v2/export`,{headers})).text();assert.ok(!backup.includes(config.accessToken));assert.ok(!backup.includes(config.vaultKey));
 const bad=await fetch(`${base}/api/v2/settings`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({batteryCapacityKwh:0})});assert.equal(bad.status,400);
});
test('config rejects oversized budget and unexpected API destinations',()=>{
 const env={QUAGOEV_ACCESS_TOKEN:'a'.repeat(40),QUAGOEV_VAULT_KEY:'ab'.repeat(32)};assert.equal(configFromEnv(env).mode,'paused');assert.throws(()=>configFromEnv({...env,QUAGOEV_MONTHLY_LIMIT_USD:'10'}));assert.throws(()=>configFromEnv({...env,TESLA_FLEET_API:'https://example.com'}));
});

test('state-only reconnect does not borrow pre-gap odometer or restart offline drive',t=>{
 const {store}=setup(t);ingestObservation(store,obs(at,'driving'));ingestObservation(store,obs(at+60000,'driving',{odometerKm:102}));
 ingestObservation(store,{eventId:'after-gap',vehicleId:'test-car',observedAt:at+3600000,state:'driving'});
 ingestObservation(store,obs(at+3660000,'parked',{odometerKm:182}));
 assert.equal(store.records('trips').reduce((n,t)=>n+t.distanceKm,0),2);
 ingestObservation(store,obs(at+3720000,'driving',{odometerKm:182}));
 ingestObservation(store,{eventId:'offline-again',vehicleId:'test-car',observedAt:at+3780000,state:'offline'});
 ingestObservation(store,{eventId:'soc-only',vehicleId:'test-car',observedAt:at+3840000,batteryLevel:70});
 assert.equal(store.getRuntime('test-car').active,null);assert.equal(store.getRuntime('test-car').last.state,'offline');
});
test('one charging observation stays unknown and partial instead of zero measured energy',t=>{
 const {store}=setup(t);ingestObservation(store,obs(at,'charging',{chargeEnergyKwh:10}));ingestObservation(store,{eventId:'lost-charge',vehicleId:'test-car',observedAt:at+60000,state:'offline'});
 const c=store.snapshot().charges[0];assert.equal(c.incomplete,true);assert.equal(c.energyKwh,null);assert.equal(c.cost,null);
});
test('sparse charging updates need fresh counter readings, including after restart',t=>{
 const {store,dir}=setup(t);
 const cases=[{id:'one-counter',next:undefined,expected:null},{id:'added-energy',next:15,expected:5},{id:'measured-zero',next:10,expected:0}];
 for(const c of cases) {
  const add=(suffix,offset,fields)=>ingestObservation(store,{eventId:`${c.id}:${suffix}`,vehicleId:c.id,observedAt:at+offset,...fields});
  add('start',0,{state:'charging',chargeEnergyKwh:10});
  add('soc',60000,{batteryLevel:65});
  if(c.next!==undefined)add('counter',120000,{chargeEnergyKwh:c.next});
  add('power',180000,{chargerPowerKw:7});
 }
 const reopened=new Store(dir);
 try {
  for(const c of cases) {
   ingestObservation(reopened,{eventId:`${c.id}:offline`,vehicleId:c.id,observedAt:at+240000,state:'offline'});
   const charge=reopened.records('charges').find(record=>record.vehicleId===c.id);
   assert.equal(charge.energyKwh,c.expected);assert.equal(charge.incomplete,true);assert.equal(charge.endBattery,65);assert.equal(charge.maxPowerKw,7);
  }
 }finally{reopened.close();}
});
test('inherited tariff remains inherited after backup restore and unrelated edits',t=>{
 const {store}=setup(t);importData(store,'snapshot',fixture);const id=fixture.charges[0].id;
 store.editSettings({homeRatePerKwh:.3});store.editRecord('charges',id,{ratePerKwh:null,cost:null,locationType:'home'});
 const backup=store.backup();assert.equal(backup.charges.find(c=>c.id===id).ratePerKwh,null);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quagoev-tariff-'));const restored=new Store(dir);
 try {importData(restored,'snapshot',backup);restored.editSettings({homeRatePerKwh:.4});restored.editRecord('charges',id,{locationName:'Garage'});const c=restored.snapshot().charges.find(c=>c.id===id);assert.equal(c.cost,Math.round(c.energyKwh*.4*100)/100);assert.equal(c.ratePerKwh,null);}finally{restored.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('server backup preserves legacy-only fields through a restore without unrelated keys',t=>{
 const {store}=setup(t);const old={trips:[],dailyStats:[{date:'2026-10-01',customMetric:123}],quagoev_settings:{currency:'AUD',electricityRates:[{location:'work',rate:.12}]},unexpectedSecret:'do not export'};importData(store,'legacy',old);
 const backup=store.backup();assert.equal(backup.legacyArchives[0].dailyStats[0].customMetric,123);assert.ok(!JSON.stringify(backup).includes('do not export'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quagoev-archive-'));const restored=new Store(dir);try{importData(restored,'snapshot',backup);assert.deepEqual(restored.backup().legacyArchives,backup.legacyArchives);}finally{restored.close();fs.rmSync(dir,{recursive:true,force:true});}
});
