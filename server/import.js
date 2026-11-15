import crypto from 'node:crypto';
import { ValidationError, object, text, finite, numberOrNull, timestamp, settingsPatch } from './validation.js';

const km = value => finite(value) && value >= 0 ? value * 1.609344 : null;
const value = (record, key, min = -Infinity, max = Infinity) => numberOrNull(record[key], min, max);
const digest = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const list = (obj, key) => { const result = obj[key] ?? []; if (!Array.isArray(result) || result.length > 250000) throw new ValidationError(`Invalid ${key} list`); return result; };
const str = (v, fallback = '') => typeof v === 'string' ? v.slice(0,4000) : fallback;
const location = p => p && finite(p.lat) && finite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

export function legacySnapshot(data) {
  object(data);
  const vehicleId = 'legacy-unassigned';
  const out = { vehicles: [{ id: vehicleId, vin: null, name: 'Imported history (vehicle unassigned)', model: null, latest: null }], trips: [], charges: [], battery: [], idles: [] };
  const tripList = [...list(data, 'trips'), ...list(data, 'quagoev_trip_history')];
  for (const t of tripList) {
    object(t); const startTime = timestamp(t.startTime), endTime = timestamp(t.endTime);
    if (endTime < startTime || km(t.distance) === null) throw new ValidationError('Invalid legacy trip');
    const route = [];
    if (location(t.startLocation)) route.push({ ...t.startLocation, timestamp: startTime });
    if (location(t.endLocation)) route.push({ ...t.endLocation, timestamp: endTime });
    const energyKwh = value(t,'energyUsed',0);
    out.trips.push({ id:`legacy:trip:${str(t.id) || digest(t).slice(0,24)}`, vehicleId, startTime, endTime, distanceKm:km(t.distance), energyKwh,
      energySource:energyKwh === null ? 'unknown':'legacy-estimate', startBattery:value(t,'startBattery',0,100), endBattery:value(t,'endBattery',0,100), route,
      tag:'unclassified', notes:'Imported from the original collector; energy used a fixed pack-size estimate.', incomplete:true });
  }
  for (const c of list(data,'chargeSessions')) {
    object(c); const startTime = timestamp(c.startTime), endTime = timestamp(c.endTime);
    if (endTime < startTime) throw new ValidationError('Invalid legacy charge');
    out.charges.push({ id:`legacy:charge:${str(c.id) || digest(c).slice(0,24)}`, vehicleId, startTime, endTime, energyKwh:value(c,'energyAdded',0), startBattery:value(c,'startBattery',0,100), endBattery:value(c,'endBattery',0,100), maxPowerKw:value(c,'maxPower',0),
      // The previous collector inferred home from charger power. Preserve that raw
      // original in imports, but do not charge it at a home tariff without confirmation.
      locationName:null, locationType:'unknown', cost:null, costSource:'unknown', ratePerKwh:null, incomplete:true });
  }
  for (const b of [...list(data,'batterySnapshots'), ...list(data,'quagoev_battery_snapshots')]) {
    object(b); const at = timestamp(b.timestamp);
    out.battery.push({ id:`legacy:battery:${at}`, vehicleId, timestamp:at, odometerKm:km(b.odometer), batteryLevel:value(b,'batteryLevel',0,100), fullRangeKm:km(b.maxRange) });
  }
  for (const s of [...list(data,'sleepRecords'), ...list(data,'quagoev_sleep_history')]) {
    object(s);
    const date = str(s.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Invalid legacy sleep date');
    const at = Date.parse(`${date}T00:00:00Z`);
    if (!finite(at)) throw new ValidationError('Invalid legacy sleep date');
    const duration = value(s,'totalParkedMinutes',0,1440) ?? 0;
    out.idles.push({ id:`legacy:idle:${date}`, vehicleId, startTime:at, endTime:at+duration*60000, energyKwh:value(s,'phantomDrainKwh',0), state:'unknown', incomplete:true });
  }
  if (!out.trips.length && !out.charges.length && !out.battery.length && !out.idles.length) out.vehicles = [];
  return out;
}

export function validateSnapshot(input) {
  object(input);
  if (input.schemaVersion !== 2) throw new ValidationError('Unsupported backup schema');
  const result = { vehicles:[], trips:[], charges:[], battery:[], idles:[] };
  const ids = new Set();
  for (const v of list(input,'vehicles')) {
    object(v); const id = text(v.id,150);
    if (!id || ids.has(id)) throw new ValidationError('Duplicate or empty vehicle ID');
    ids.add(id);
    let latest = null;
    if (v.latest) {
      object(v.latest); const l = v.latest;
      latest = { observedAt:timestamp(l.observedAt), state:text(l.state,50), batteryLevel:value(l,'batteryLevel',0,100), estimatedRangeKm:value(l,'estimatedRangeKm',0), odometerKm:value(l,'odometerKm',0), outsideTempC:value(l,'outsideTempC',-100,100), chargingState:l.chargingState == null ? null:text(l.chargingState,50), chargerPowerKw:value(l,'chargerPowerKw',0), latitude:value(l,'latitude',-90,90), longitude:value(l,'longitude',-180,180) };
    }
    result.vehicles.push({ id, vin:v.vin == null ? null:text(v.vin,30), name:text(v.name,200), model:v.model == null ? null:text(v.model,100), latest });
  }
  for (const kind of ['trips','charges','battery','idles']) for (const r of list(input,kind)) {
    object(r); const id = text(r.id,250), vehicleId = text(r.vehicleId,150);
    if (!id || !ids.has(vehicleId)) throw new ValidationError('Record has an unknown vehicle');
    if (kind === 'battery') {
      result.battery.push({ id, vehicleId, timestamp:timestamp(r.timestamp), odometerKm:value(r,'odometerKm',0), batteryLevel:value(r,'batteryLevel',0,100), fullRangeKm:value(r,'fullRangeKm',0) }); continue;
    }
    const startTime = timestamp(r.startTime), endTime = timestamp(r.endTime);
    if (endTime < startTime) throw new ValidationError('Record ends before it starts');
    const common = { id, vehicleId, startTime, endTime, energyKwh:value(r,'energyKwh',0) };
    if (kind === 'trips') {
      if (value(r,'distanceKm',0) === null) throw new ValidationError('Invalid trip distance');
      const route = list(r,'route').map(p => { object(p); if (!location(p)) throw new ValidationError('Invalid route coordinate'); return { lat:p.lat,lng:p.lng,timestamp:timestamp(p.timestamp) }; });
      result.trips.push({ ...common,distanceKm:r.distanceKm, energySource:['measured','estimated','legacy-estimate','unknown'].includes(r.energySource) ? r.energySource:'unknown',startBattery:value(r,'startBattery',0,100),endBattery:value(r,'endBattery',0,100),route,tag:['personal','business','unclassified'].includes(r.tag) ? r.tag:'unclassified',notes:text(r.notes ?? '',4000),incomplete:!!r.incomplete });
    } else if (kind === 'charges') {
      result.charges.push({ ...common,startBattery:value(r,'startBattery',0,100),endBattery:value(r,'endBattery',0,100),maxPowerKw:value(r,'maxPowerKw',0),locationName:r.locationName == null ? null:text(r.locationName,200), locationType:['home','work','public','unknown'].includes(r.locationType) ? r.locationType:'unknown', cost:value(r,'cost',0),costSource:['actual','estimated','unknown'].includes(r.costSource) ? r.costSource:'unknown',ratePerKwh:value(r,'ratePerKwh',0),incomplete:!!r.incomplete });
    } else result.idles.push({ ...common,state:['asleep','parked','unknown'].includes(r.state) ? r.state:'unknown',incomplete:!!r.incomplete });
  }
  return result;
}

export function importData(store, format, input) {
  const hash = digest({format,input});
  if (store.db.prepare('SELECT digest FROM imports WHERE digest=?').get(hash)) return false;
  const data = format === 'legacy' ? legacySnapshot(input) : format === 'snapshot' ? validateSnapshot(input) : (()=>{throw new ValidationError('Unknown import format');})();
  const sourceSettings = format === 'snapshot' ? input.settings : input.quagoev_settings;
  const restoreSettings = {};
  if(sourceSettings&&typeof sourceSettings==='object') {
    for(const key of ['currency','timeZone','homeRatePerKwh','batteryCapacityKwh']) if(key in sourceSettings) restoreSettings[key]=sourceSettings[key];
    if(format==='legacy'&&Array.isArray(sourceSettings.electricityRates)) {
      const home=sourceSettings.electricityRates.find(r=>r.location==='home');
      if(home&&finite(home.rate)&&home.rate>=0)restoreSettings.homeRatePerKwh=home.rate;
    }
  }
  const checkedSettings=settingsPatch(restoreSettings);
  const archives=format==='snapshot'?list(input,'legacyArchives'):[];
  for(const archive of archives)legacySnapshot(archive);
  store.transaction(() => {
    const empty=store.db.prepare('SELECT COUNT(*) AS count FROM records').get().count===0;
    for (const vehicle of data.vehicles) if (!store.vehicle(vehicle.id)) store.putVehicle(vehicle);
    for (const kind of ['trips','charges','battery','idles']) for (const record of data[kind]) store.putRecord(kind,record,{replace:false});
    // Restore owner preferences on a fresh installation; existing user settings
    // and all collector credentials/permissions remain untouched.
    if(empty)store.setMeta('settings',{...store.getMeta('settings'),...checkedSettings});
    store.db.prepare('INSERT INTO imports(digest,imported_at,original) VALUES(?,?,?)').run(hash,Date.now(),JSON.stringify(input));
    for(const archive of archives)store.db.prepare('INSERT OR IGNORE INTO imports(digest,imported_at,original) VALUES(?,?,?)').run(digest({format:'legacy',input:archive}),Date.now(),JSON.stringify(archive));
    store.bump();
  });
  return true;
}
