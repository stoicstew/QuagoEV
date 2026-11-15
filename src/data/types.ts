export interface Settings {
  currency: string;
  distanceUnit: 'km';
  temperatureUnit: 'C';
  timeZone: string;
  homeRatePerKwh: number | null;
  batteryCapacityKwh: number | null;
}
export interface Vehicle {
  id: string; vin: string | null; name: string; model: string | null;
  latest: null | {
    observedAt: number; state: string; batteryLevel: number | null;
    estimatedRangeKm: number | null; odometerKm: number | null;
    outsideTempC: number | null; chargingState: string | null; chargerPowerKw: number | null;
    latitude: number | null; longitude: number | null;
  };
}
export interface Trip {
  id: string; vehicleId: string; startTime: number; endTime: number;
  distanceKm: number; energyKwh: number | null;
  energySource: 'measured' | 'estimated' | 'legacy-estimate' | 'unknown';
  startBattery: number | null; endBattery: number | null;
  route: Array<{ lat: number; lng: number; timestamp: number }>;
  tag: 'personal' | 'business' | 'unclassified'; notes: string; incomplete: boolean;
}
export interface Charge {
  id: string; vehicleId: string; startTime: number; endTime: number;
  energyKwh: number | null; startBattery: number | null; endBattery: number | null;
  maxPowerKw: number | null; locationName: string | null;
  locationType: 'home' | 'work' | 'public' | 'unknown';
  cost: number | null; costSource: 'actual' | 'estimated' | 'unknown'; ratePerKwh: number | null; incomplete?: boolean;
}
export interface BatteryReading {
  id: string; vehicleId: string; timestamp: number; odometerKm: number | null;
  batteryLevel: number | null; fullRangeKm: number | null;
}
export interface Idle {
  id: string; vehicleId: string; startTime: number; endTime: number;
  energyKwh: number | null; state: 'asleep' | 'parked' | 'unknown'; incomplete: boolean;
}
export interface Snapshot {
  schemaVersion: 2; serverId: string; revision: number; generatedAt: number;
  settings: Settings; vehicles: Vehicle[]; trips: Trip[]; charges: Charge[];
  battery: BatteryReading[]; idles: Idle[];
  collector: {
    mode: 'paused' | 'polling' | 'telemetry';
    status: 'paused' | 'waiting_for_auth' | 'collecting' | 'error' | 'budget_paused';
    lastReceivedAt: number | null; message: string;
    usage: { month: string; estimatedCostUsd: number; limitUsd: number; requests: number; signals: number };
  };
}

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optionalNumber = (v: unknown) => v === null || number(v);
const string = (v: unknown): v is string => typeof v === 'string';
const optionalString = (v: unknown) => v === null || string(v);
const oneOf = (v: unknown, values: string[]) => string(v) && values.includes(v);
const identified = (v: unknown): v is RecordValue => object(v) && string(v.id) && string(v.vehicleId);
const dated = (v: unknown): v is RecordValue => identified(v) && number(v.startTime) && number(v.endTime) && v.endTime >= v.startTime;
const list = (v: unknown, test: (r: unknown) => boolean) => Array.isArray(v) && v.every(test);

export function validateSnapshot(v: unknown): Snapshot {
  if (!object(v) || v.schemaVersion !== 2 || !string(v.serverId) || !v.serverId || !number(v.revision) || !number(v.generatedAt)) throw new Error('The server returned an incompatible data format.');
  const s = v.settings;
  const c = v.collector;
  if (!object(s) || !string(s.currency) || !/^[A-Z]{3}$/.test(s.currency) || !string(s.timeZone) || s.distanceUnit !== 'km' || s.temperatureUnit !== 'C' || !optionalNumber(s.homeRatePerKwh) || !optionalNumber(s.batteryCapacityKwh)) throw new Error('The server returned invalid settings.');
  try { new Intl.DateTimeFormat('en-AU', { timeZone: s.timeZone }); new Intl.NumberFormat('en-AU', { style: 'currency', currency: s.currency }); } catch { throw new Error('The server returned an unsupported timezone or currency.'); }
  if (!object(c) || !oneOf(c.mode, ['paused', 'polling', 'telemetry']) || !oneOf(c.status, ['paused', 'waiting_for_auth', 'collecting', 'error', 'budget_paused']) || !optionalNumber(c.lastReceivedAt) || !string(c.message) || !object(c.usage) || !string(c.usage.month) || ![c.usage.estimatedCostUsd, c.usage.limitUsd, c.usage.requests, c.usage.signals].every(number)) throw new Error('The server returned invalid collection status.');
  if (!list(v.vehicles, r => object(r) && string(r.id) && string(r.name) && optionalString(r.vin) && optionalString(r.model) && (r.latest === null || (object(r.latest) && number(r.latest.observedAt) && string(r.latest.state) && optionalString(r.latest.chargingState) && ['batteryLevel', 'estimatedRangeKm', 'odometerKm', 'outsideTempC', 'chargerPowerKw', 'latitude', 'longitude'].every(k => optionalNumber((r.latest as RecordValue)[k])))))) throw new Error('The server returned invalid vehicle data.');
  if (!list(v.trips, r => dated(r) && number(r.distanceKm) && r.distanceKm >= 0 && optionalNumber(r.energyKwh) && oneOf(r.energySource, ['measured', 'estimated', 'legacy-estimate', 'unknown']) && optionalNumber(r.startBattery) && optionalNumber(r.endBattery) && oneOf(r.tag, ['personal', 'business', 'unclassified']) && string(r.notes) && typeof r.incomplete === 'boolean' && list(r.route, p => object(p) && number(p.lat) && Math.abs(p.lat) <= 90 && number(p.lng) && Math.abs(p.lng) <= 180 && number(p.timestamp)))) throw new Error('The server returned invalid drive records.');
  if (!list(v.charges, r => dated(r) && ['energyKwh', 'startBattery', 'endBattery', 'maxPowerKw', 'cost', 'ratePerKwh'].every(k => optionalNumber(r[k])) && optionalString(r.locationName) && oneOf(r.locationType, ['home', 'work', 'public', 'unknown']) && oneOf(r.costSource, ['actual', 'estimated', 'unknown']))) throw new Error('The server returned invalid charging records.');
  if (!list(v.battery, r => identified(r) && number(r.timestamp) && ['odometerKm', 'batteryLevel', 'fullRangeKm'].every(k => optionalNumber(r[k])))) throw new Error('The server returned invalid battery records.');
  if (!list(v.idles, r => dated(r) && optionalNumber(r.energyKwh) && oneOf(r.state, ['asleep', 'parked', 'unknown']) && typeof r.incomplete === 'boolean')) throw new Error('The server returned invalid idle records.');
  return v as unknown as Snapshot;
}
