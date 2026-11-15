import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeTelemetryRecord } from '../server/telemetry-normalize.js';
import { replayFile, ingestUrl } from '../scripts/telemetry-bridge.mjs';

const vin = '5YJ3E1EA0NF000000';
const at = '2026-01-02T03:04:05Z';
const logger = fields => ({ msg:'record_payload', vin, metadata:{txtype:'V',txid:'first'}, data:{ Vin:vin, CreatedAt:at, IsResend:false, ...fields } });
const sample = () => logger({ Soc:72, Gear:'ShiftStateD', Odometer:100, Location:{latitude:-37.8,longitude:144.9}, VehicleName:'Sample' });

test('official flat logger schema normalizes units and state with no guessed readings', () => {
  const { signals, observation } = normalizeTelemetryRecord(sample());
  assert.equal(signals,5);
  assert.equal(observation.observedAt,Date.parse(at));
  assert.equal(observation.odometerKm,160.9344);
  assert.equal(observation.state,'driving');
  assert.equal(observation.latitude,-37.8);
  assert.equal(observation.batteryLevel,72);
  assert.equal(observation.vehicleId,vin);
  assert.equal('chargeEnergyKwh' in observation,false);
});
test('verbose values and raw protobuf JSON both support numeric strings and invalid signals', () => {
  const verbose=normalizeTelemetryRecord(logger({ BatteryLevel:{doubleValue:0}, Odometer:{doubleValue:'100'}, OutsideTemp:{invalid:true}, Gear:{shiftStateValue:'ShiftStateP'}, Location:{locationValue:{latitude:0,longitude:0}} }));
  assert.equal(verbose.observation.batteryLevel,0);
  assert.equal(verbose.observation.state,'parked');
  assert.equal(verbose.observation.latitude,0);
  assert.equal('outsideTempC' in verbose.observation,false);
  const raw=normalizeTelemetryRecord({vin,createdAt:at,data:[{key:5,value:{doubleValue:100}},{key:'Soc',value:{stringValue:'72.5'}},{key:'FutureSignal',value:{invalid:true}}]});
  assert.equal(raw.signals,3);
  assert.equal(raw.observation.odometerKm,160.9344);
  assert.equal(raw.observation.batteryLevel,72.5);
  assert.equal('state' in raw.observation,false);
});
test('sparse patches never fabricate parked, charging or zero values', () => {
  const result=normalizeTelemetryRecord(logger({ Soc:'', Odometer:'NaN', OutsideTemp:'<invalid>', VehicleSpeed:0 }));
  assert.equal(result.signals,4);
  for(const field of ['state','batteryLevel','odometerKm','outsideTempC']) assert.equal(field in result.observation,false);
});
test('charging uses battery-side DCChargingEnergyIn for AC and DC, not mixed counters', () => {
  const result=normalizeTelemetryRecord(logger({ DetailedChargeState:{detailedChargeState:'DetailedChargeStateCharging'}, DCChargingEnergyIn:10, ACChargingEnergyIn:12, ACChargingPower:7 }));
  assert.equal(result.observation.state,'charging');
  assert.equal(result.observation.chargeEnergyKwh,10);
  assert.equal(result.observation.chargerPowerKw,7);
  assert.equal('chargeEnergyKwh' in normalizeTelemetryRecord(logger({ACChargingEnergyIn:12})).observation,false);
});
test('disconnected telemetry is offline, never evidence the car is asleep', () => {
  const result=normalizeTelemetryRecord({msg:'record_payload',vin,metadata:{txtype:'connectivity'},data:{Vin:vin,Status:'DISCONNECTED',CreatedAt:Date.parse(at)/1000}});
  assert.equal(result.signals,0); assert.equal(result.observation.state,'offline');
  assert.equal(normalizeTelemetryRecord({msg:'server_started'}),null);
});
test('replay identifiers survive resend flags, JSON ordering and changed logger metadata', () => {
  const original=sample();
  const repeated={...original,metadata:{...original.metadata,txid:'new',receivedat:'later'},data:Object.fromEntries(Object.entries({...original.data,IsResend:true}).reverse())};
  assert.equal(normalizeTelemetryRecord(original).observation.eventId,normalizeTelemetryRecord(repeated).observation.eventId);
});
test('malformed identity, timestamps and remote ingest targets are rejected', () => {
  assert.throws(()=>normalizeTelemetryRecord({...sample(),vin:'bad'}));
  assert.throws(()=>normalizeTelemetryRecord(logger({CreatedAt:'not a date'})));
  assert.throws(()=>ingestUrl('https://example.com/internal/observations'));
  assert.throws(()=>ingestUrl('http://127.0.0.1:3001/api/v2/snapshot'));
  assert.equal(ingestUrl(),'http://127.0.0.1:3001/internal/observations');
});
async function fixture(fn) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'quagoev-telemetry-test-'));
  try { await fn({directory,filename:path.join(directory,'receiver.jsonl'),checkpoint:path.join(directory,'checkpoint.json'),url:ingestUrl(),token:'synthetic-telemetry-token-not-a-real-token'}); }
  finally { await fs.rm(directory,{recursive:true,force:true}); }
}
test('file checkpoint advances after successful ingestion and replay does not resend acknowledged lines',async()=>fixture(async(options)=>{
  await fs.writeFile(options.filename,JSON.stringify(sample())+'\n');
  let calls=0;
  const fetchImpl=async(url,request)=>{calls++; assert.equal(request.redirect,'error'); assert.equal(JSON.parse(request.body).signals,5); return new Response('{}',{status:200});};
  assert.equal((await replayFile({...options,fetchImpl})).records,1);
  assert.equal((await replayFile({...options,fetchImpl})).records,0);
  assert.equal(calls,1);
}));
test('failed ingestion keeps record pending, including an exhausted budget',async()=>fixture(async(options)=>{
  await fs.writeFile(options.filename,JSON.stringify(sample())+'\n');
  await assert.rejects(replayFile({...options,fetchImpl:async()=>new Response('{}',{status:409})}),/does not stop Tesla streaming/);
  await assert.rejects(replayFile({...options,fetchImpl:async()=>new Response('{}',{status:429})}),error => error.retryable === false);
  await assert.rejects(fs.readFile(options.checkpoint),{code:'ENOENT'});
  assert.equal((await replayFile({...options,fetchImpl:async()=>new Response('{}',{status:200})})).records,1);
}));
test('partial UTF-8 lines remain pending until completed; rotation fails closed',async()=>fixture(async(options)=>{
  const entry=logger({VehicleName:'Sample café'});
  const line=JSON.stringify(entry);
  await fs.writeFile(options.filename,line);
  const fetchImpl=async()=>new Response('{}',{status:200});
  assert.equal((await replayFile({...options,fetchImpl})).records,0);
  await fs.appendFile(options.filename,'\n');
  assert.equal((await replayFile({...options,fetchImpl})).records,1);
  await fs.writeFile(options.filename,'{}\n');
  await assert.rejects(replayFile({...options,fetchImpl}),/replaced or truncated/);
}));
