import crypto from 'node:crypto';

// Shapes verified against teslamotors/fleet-telemetry at
// bb7c8a931e46da3b3eb6d20a67541c8f755f1ee6: datastore/simple/logger.go,
// datastore/simple/transformers/payload.go and protos/vehicle_data.proto.
const META = new Set(['Vin', 'CreatedAt', 'IsResend']);
const SCALARS = ['stringValue','intValue','longValue','floatValue','doubleValue','booleanValue','shiftStateValue','chargingValue','detailedChargeState','detailedChargeStateValue','carType','carTypeValue','string_value','int_value','long_value','float_value','double_value','boolean_value','shift_state_value','charging_value','detailed_charge_state_value','car_type_value'];
const ENUM_FIELDS = { 4:'VehicleSpeed', 5:'Odometer', 8:'Soc', 10:'Gear', 21:'Location', 35:'DCChargingPower', 37:'ACChargingPower', 34:'DCChargingEnergyIn', 40:'EstBatteryRange', 41:'IdealBatteryRange', 42:'BatteryLevel', 64:'VehicleName', 86:'OutsideTemp', 103:'LifetimeEnergyUsedDrive', 113:'CarType', 179:'DetailedChargeState' };
const MILES_TO_KM = 1.609344;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
function unwrap(value) {
  if (value === '<invalid>' || value === null || value === undefined) return undefined;
  if (!isObject(value)) return value;
  if (value.invalid === true) return undefined;
  if ('locationValue' in value) return value.locationValue;
  if ('location_value' in value) return value.location_value;
  for (const key of SCALARS) if (Object.hasOwn(value, key)) return value[key];
  // Plain logger location objects already have latitude and longitude.
  if ('latitude' in value || 'longitude' in value) return value;
  return undefined;
}
function number(value, min = -Infinity, max = Infinity) {
  const raw = unwrap(value);
  if (raw === undefined || typeof raw === 'boolean' || (typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim())) return undefined;
  const result = Number(raw);
  return Number.isFinite(result) && result >= min && result <= max ? result : undefined;
}
function text(value) { const raw = unwrap(value); return typeof raw === 'string' && raw.length <= 200 && raw.trim() ? raw.trim() : undefined; }
function timestamp(value) {
  let parsed;
  if (typeof value === 'string' && /[TZ]/.test(value)) parsed = Date.parse(value);
  else if (typeof value === 'number' || typeof value === 'string') { parsed = Number(value); if (parsed > 0 && parsed < 1e12) parsed *= 1000; }
  else if (isObject(value) && value.seconds !== undefined) parsed = Number(value.seconds) * 1000 + Number(value.nanos || 0) / 1e6;
  if (!Number.isFinite(parsed) || parsed < Date.UTC(2000, 0, 1) || parsed > Date.now() + 300000) throw new Error('Telemetry record has an invalid observation timestamp.');
  return Math.trunc(parsed);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function stableId(vin, at, kind, fields) {
  const identity = { vin, at, kind, fields };
  return 'telemetry:' + crypto.createHash('sha256').update(JSON.stringify(canonical(identity))).digest('hex');
}
function chargeLabel(value) {
  const raw = unwrap(value);
  if (typeof raw === 'number') return ['Unknown', 'Disconnected', 'NoPower', 'Starting', 'Charging', 'Complete', 'Stopped'][raw];
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.replace(/^(DetailedChargeState|ChargeState)/, '');
  return ['Disconnected','NoPower','Starting','Charging','Complete','Stopped'].includes(normalized) ? normalized : undefined;
}
function gearLabel(value) {
  const raw = unwrap(value);
  if (typeof raw === 'number') return { 2:'P', 3:'R', 4:'N', 5:'D' }[raw];
  if (typeof raw === 'string') return raw.replace(/^ShiftState/, '');
}

/** Parse one official JSON logger record or one decoded protobuf payload.
 * Null means an unrelated non-vehicle log record; invalid vehicle data throws.
 * Absent/invalid readings are omitted, never fabricated as zero.
 */
export function normalizeTelemetryRecord(record) {
  if (!isObject(record)) throw new Error('Telemetry input must be a JSON object.');
  let fields, vin, createdAt, kind = 'V', signals;
  if (record.msg !== undefined) {
    if (record.msg !== 'record_payload') return null;
    kind = record.metadata?.txtype;
    if (!['V', 'connectivity'].includes(kind)) return null;
    if (!isObject(record.data)) throw new Error('Telemetry logger record is missing its data map.');
    fields = record.data;
    vin = record.vin || fields.Vin;
    createdAt = fields.CreatedAt;
    signals = kind === 'V' ? Object.keys(fields).filter(key => !META.has(key)).length : 0;
  } else if (Array.isArray(record.data)) {
    vin = record.vin;
    createdAt = record.createdAt ?? record.created_at;
    signals = record.data.length;
    fields = {};
    for (const datum of record.data) {
      if (!isObject(datum) || datum.key === undefined) continue;
      const key = typeof datum.key === 'number' ? ENUM_FIELDS[datum.key] || `unknown_${datum.key}` : datum.key;
      if (typeof key === 'string' && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') fields[key] = datum.value;
    }
  } else return null;
  if (typeof vin !== 'string' || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) throw new Error('Telemetry record has no valid vehicle identity.');
  vin = vin.toUpperCase();
  if (signals > 1000) throw new Error('Telemetry record contains too many signals.');
  const observedAt = timestamp(createdAt);
  const hashFields = Object.fromEntries(Object.entries(fields).filter(([key]) => !META.has(key)));
  const observation = { eventId: stableId(vin, observedAt, kind, hashFields), vehicleId: vin, vin, observedAt };
  if (kind === 'connectivity') {
    if (fields.Status === 'DISCONNECTED') observation.state = 'offline';
    else if (fields.Status === 'CONNECTED' || fields.Status === 'UNKNOWN') observation.state = 'unknown';
    return { signals, observation };
  }
  const put = (key, value) => { if (value !== undefined) observation[key] = value; };
  put('name', text(fields.VehicleName));
  const model = text(fields.CarType);
  if (model && model !== 'CarTypeUnknown') put('model', model.replace(/^CarType/, '').replace(/^Model([SXY3])$/, 'Model $1'));
  put('batteryLevel', number(fields.BatteryLevel, 0, 100) ?? number(fields.Soc, 0, 100));
  const range = number(fields.EstBatteryRange, 0) ?? number(fields.IdealBatteryRange, 0);
  put('estimatedRangeKm', range === undefined ? undefined : range * MILES_TO_KM);
  const odometer = number(fields.Odometer, 0);
  put('odometerKm', odometer === undefined ? undefined : odometer * MILES_TO_KM);
  put('outsideTempC', number(fields.OutsideTemp, -100, 100));
  const power = [number(fields.DCChargingPower, 0), number(fields.ACChargingPower, 0)].filter(value => value !== undefined);
  if (power.length) put('chargerPowerKw', Math.max(...power));
  // Tesla documents DCChargingEnergyIn as energy added at the battery for BOTH
  // AC and DC sessions. Never switch this counter to AC charger-input energy.
  put('chargeEnergyKwh', number(fields.DCChargingEnergyIn, 0));
  put('lifetimeDriveEnergyKwh', number(fields.LifetimeEnergyUsedDrive, 0));
  const location = unwrap(fields.Location);
  if (isObject(location)) {
    const latitude = number(location.latitude, -90, 90), longitude = number(location.longitude, -180, 180);
    if (latitude !== undefined && longitude !== undefined) { put('latitude', latitude); put('longitude', longitude); }
  }
  const gear = gearLabel(fields.Gear), charge = chargeLabel(fields.DetailedChargeState) || chargeLabel(fields.ChargeState);
  put('chargingState', charge);
  if (['D', 'R', 'N'].includes(gear) || (number(fields.VehicleSpeed, 0) ?? 0) > 0) observation.state = 'driving';
  else if (charge === 'Charging') observation.state = 'charging';
  else if (gear === 'P' || ['Disconnected','NoPower','Complete','Stopped'].includes(charge)) observation.state = 'parked';
  return { signals, observation };
}
