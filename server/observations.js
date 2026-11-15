import { ValidationError, finite, numberOrNull, timestamp, object, text } from './validation.js';

const nullableFields = ['batteryLevel','estimatedRangeKm','odometerKm','outsideTempC','chargerPowerKw','latitude','longitude','chargeEnergyKwh','lifetimeDriveEnergyKwh'];
export function validateObservation(input) {
  object(input);
  const result = { eventId:text(input.eventId,250),vehicleId:text(input.vehicleId,150),observedAt:timestamp(input.observedAt) };
  if(!result.eventId||!result.vehicleId) throw new ValidationError('Missing observation identity');
  if(result.observedAt>Date.now()+300000) throw new ValidationError('Observation timestamp is in the future');
  for(const key of nullableFields) if(key in input) {
    if(input[key]!==null&&!finite(input[key])) throw new ValidationError(`Invalid ${key}`);
    result[key]=input[key];
  }
  for(const key of ['name','model','vin','chargingState','state']) if(key in input) result[key]=input[key]===null?null:text(input[key],200);
  if(result.batteryLevel!=null&&(result.batteryLevel<0||result.batteryLevel>100)) throw new ValidationError('Invalid battery level');
  for(const key of ['estimatedRangeKm','odometerKm','chargerPowerKw','chargeEnergyKwh','lifetimeDriveEnergyKwh']) if(result[key]!=null&&result[key]<0) throw new ValidationError(`Negative ${key}`);
  if(result.latitude!=null&&Math.abs(result.latitude)>90||result.longitude!=null&&Math.abs(result.longitude)>180) throw new ValidationError('Invalid coordinates');
  if(result.state!=null&&!['driving','charging','parked','asleep','offline','unknown'].includes(result.state)) throw new ValidationError('Invalid vehicle state');
  return result;
}

const emptyLatest = { observedAt:0,state:'unknown',batteryLevel:null,estimatedRangeKm:null,odometerKm:null,outsideTempC:null,chargingState:null,chargerPowerKw:null,latitude:null,longitude:null };
const routePoint = o => finite(o.latitude)&&finite(o.longitude)?{lat:o.latitude,lng:o.longitude,timestamp:o.observedAt}:null;
const energyDelta = (start,end,capacity) => {
  if(finite(start.lifetimeDriveEnergyKwh)&&finite(end.lifetimeDriveEnergyKwh)&&end.lifetimeDriveEnergyKwh>=start.lifetimeDriveEnergyKwh) return {energyKwh:end.lifetimeDriveEnergyKwh-start.lifetimeDriveEnergyKwh,energySource:'measured'};
  if(finite(capacity)&&finite(start.batteryLevel)&&finite(end.batteryLevel)&&start.batteryLevel>=end.batteryLevel) return {energyKwh:(start.batteryLevel-end.batteryLevel)*capacity/100,energySource:'estimated'};
  return {energyKwh:null,energySource:'unknown'};
};

function finish(store,vehicleId,active,last,capacity,incomplete) {
  if(!active||!last||last.observedAt<active.start.observedAt) return;
  const start=active.start, endTime=last.observedAt;
  const id=`${vehicleId}:${active.kind}:${start.observedAt}`;
  if(active.kind==='driving') {
    const distanceKm=finite(start.odometerKm)&&finite(last.odometerKm)?Math.max(0,last.odometerKm-start.odometerKm):0;
    const previous=store.record('trips',id);
    store.putRecord('trips',{id,vehicleId,startTime:start.observedAt,endTime,distanceKm,...energyDelta(start,last,capacity),startBattery:start.batteryLevel??null,endBattery:last.batteryLevel??null,route:active.route||[],tag:previous?.tag||'unclassified',notes:previous?.notes||'',incomplete:incomplete||active.incomplete||!finite(start.odometerKm)||!finite(last.odometerKm)||last.odometerKm<start.odometerKm});
  } else if(active.kind==='charging') {
    const freshCounter=finite(start.chargeEnergyObservedAt)&&finite(last.chargeEnergyObservedAt)&&last.chargeEnergyObservedAt>start.chargeEnergyObservedAt;
    const energyKwh=freshCounter&&finite(start.chargeEnergyKwh)&&finite(last.chargeEnergyKwh)&&last.chargeEnergyKwh>=start.chargeEnergyKwh?last.chargeEnergyKwh-start.chargeEnergyKwh:null;
    const previous=store.record('charges',id);
    store.putRecord('charges',{id,vehicleId,startTime:start.observedAt,endTime,energyKwh,startBattery:start.batteryLevel??null,endBattery:last.batteryLevel??null,maxPowerKw:active.maxPowerKw??null,locationName:previous?.locationName??null,locationType:previous?.locationType||'unknown',cost:previous?.cost??null,costSource:previous?.costSource||'unknown',ratePerKwh:previous?.ratePerKwh??null,incomplete:!!incomplete||!!active.incomplete||energyKwh===null});
  } else {
    store.putRecord('idles',{id,vehicleId,startTime:start.observedAt,endTime,energyKwh:energyDelta({...start,lifetimeDriveEnergyKwh:null},{...last,lifetimeDriveEnergyKwh:null},capacity).energyKwh,state:active.kind==='asleep'?'asleep':'parked',incomplete:incomplete||!!active.incomplete});
  }
}

export function ingestObservation(store,input,{maxGapMs=30*60000}={}) {
  const o=validateObservation(input);
  return store.transaction(()=>{
    if(store.db.prepare('SELECT event_id FROM received WHERE event_id=?').get(o.eventId)) return false;
    const existing=store.vehicle(o.vehicleId);
    const runtime=store.getRuntime(o.vehicleId)||{last:null,active:null};
    store.db.prepare('INSERT INTO received(event_id,received_at) VALUES(?,?)').run(o.eventId,Date.now());
    if(existing?.latest&&o.observedAt<existing.latest.observedAt) return false;
    const latest={...(existing?.latest||emptyLatest)};
    for(const key of Object.keys(emptyLatest)) if(key in o) latest[key]=o[key];
    latest.observedAt=o.observedAt;
    const gap=runtime.last&&o.observedAt-runtime.last.observedAt>maxGapMs;
    const wasUnknown=!runtime.last||['offline','unknown'].includes(runtime.last.state);
    // A delta after a gap cannot reuse old counter baselines. Display may retain
    // the last known values, but session arithmetic uses only fresh evidence.
    const merged={...(!gap&&!wasUnknown?runtime.last:{}),...o};
    // Sparse SOC/power messages advance the event time without measuring energy.
    // Persist counter freshness separately so those updates cannot invent a delta.
    if('chargeEnergyKwh' in o) merged.chargeEnergyObservedAt=finite(o.chargeEnergyKwh)?o.observedAt:null;
    const state=o.state||(!gap?runtime.last?.state:null)||'unknown'; merged.state=state;
    latest.state=state;
    const capacity=store.getMeta('settings').batteryCapacityKwh;
    const unknown=['offline','unknown'].includes(state);
    if(runtime.active&&(gap||unknown||state!==runtime.active.kind)) {
      // A reliable boundary sample can close a session. Missing/offline samples
      // close at the last observation, never substitute zero readings.
      let end=(gap||unknown||state==='asleep')?(runtime.active.last||runtime.last):merged;
      // Charge counter often resets when unplugged; retain its last good value.
      if(runtime.active.kind==='charging'&&(!finite(end?.chargeEnergyKwh)||end.chargeEnergyKwh<(runtime.last?.chargeEnergyKwh??0))) end=runtime.active.last||runtime.last;
      if(runtime.active.kind==='driving'&&end===merged&&('latitude' in o||'longitude' in o)) {
        const point=routePoint(merged);if(point)runtime.active.route.push(point);
      }
      finish(store,o.vehicleId,runtime.active,end,capacity,!!gap||unknown||state==='asleep');
      runtime.active=null;
    }
    if(!unknown) {
      if(!runtime.active) runtime.active={kind:state,start:{...merged},route:[],maxPowerKw:merged.chargerPowerKw??null,incomplete:!!gap||wasUnknown};
      if(state==='driving'&&('latitude' in o||'longitude' in o)) {
        const point=routePoint(merged);
        if(point) { runtime.active.route.push(point); if(runtime.active.route.length>10000) runtime.active.route=runtime.active.route.filter((_,i)=>i%2===0); }
      }
      if(state==='charging'&&finite(merged.chargerPowerKw)) runtime.active.maxPowerKw=Math.max(runtime.active.maxPowerKw||0,merged.chargerPowerKw);
      runtime.active.last={...merged};
    }
    // Record unknown/offline as the current state too. A subsequent SOC-only
    // message must not resurrect the driving state from before disconnection.
    runtime.last=unknown?{...o,state}:merged;
    store.putRuntime(o.vehicleId,runtime);
    store.putVehicle({id:o.vehicleId,vin:o.vin??existing?.vin??null,name:o.name||existing?.name||'Tesla',model:o.model??existing?.model??null,latest});
    if(finite(o.estimatedRangeKm)&&finite(o.batteryLevel)&&o.batteryLevel>=20) {
      // One sample per UTC day; labelled range estimates, never a health diagnosis.
      const day=new Date(o.observedAt).toISOString().slice(0,10);
      store.putRecord('battery',{id:`${o.vehicleId}:battery:${day}`,vehicleId:o.vehicleId,timestamp:o.observedAt,odometerKm:o.odometerKm??null,batteryLevel:o.batteryLevel,fullRangeKm:o.estimatedRangeKm/(o.batteryLevel/100)});
    }
    store.setMeta('lastReceivedAt',o.observedAt);store.bump();
    store.collector.lastReceivedAt=o.observedAt;
    return true;
  });
}

export function fromFleetData(vehicle,data,at=Date.now()) {
  const cs=data?.charge_state||{},ds=data?.drive_state||{},vs=data?.vehicle_state||{};
  let state=vehicle.state==='asleep'?'asleep':vehicle.state==='offline'?'offline':'unknown';
  if(data) {
    if(['D','R','N'].includes(ds.shift_state)||ds.speed>0) state='driving';
    else if(cs.charging_state==='Charging') state='charging';
    else if(ds.shift_state==='P'||ds.shift_state===null) state='parked';
  }
  const miToKm=n=>finite(n)?n*1.609344:null;
  const id=vehicle.vin||String(vehicle.id_s||vehicle.id);
  const observation={eventId:`poll:${id}:${at}`,vehicleId:id,vin:vehicle.vin||null,name:vehicle.display_name||'Tesla',model:data?.vehicle_config?.car_type||null,observedAt:at,state};
  if(data) Object.assign(observation,{batteryLevel:numberOrNull(cs.battery_level,0,100),estimatedRangeKm:miToKm(cs.battery_range??cs.ideal_battery_range),odometerKm:miToKm(vs.odometer),outsideTempC:numberOrNull(data?.climate_state?.outside_temp),chargingState:cs.charging_state||null,chargerPowerKw:numberOrNull(cs.charger_power,0),latitude:numberOrNull(ds.latitude,-90,90),longitude:numberOrNull(ds.longitude,-180,180),chargeEnergyKwh:numberOrNull(cs.charge_energy_added,0)});
  return observation;
}
