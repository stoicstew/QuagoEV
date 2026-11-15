import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ValidationError, settingsPatch, tripPatch, chargePatch } from './validation.js';

export const defaultSettings = { currency: 'AUD', distanceUnit: 'km', temperatureUnit: 'C', timeZone: 'Australia/Melbourne', homeRatePerKwh: null, batteryCapacityKwh: null };
const kinds = ['trips', 'charges', 'battery', 'idles'];
export class Store {
  constructor(dataDir, { limit = 8, mode = 'paused' } = {}) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataDir, 'quagoev.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vehicles(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, vehicle_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS records_vehicle_date ON records(vehicle_id,occurred_at);
      CREATE TABLE IF NOT EXISTS runtime(vehicle_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(month TEXT PRIMARY KEY, cost REAL NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, signals INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS imports(digest TEXT PRIMARY KEY, imported_at INTEGER NOT NULL, original TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS received(event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);`);
    if (!this.getMeta('serverId')) this.setMeta('serverId', crypto.randomUUID());
    if (!this.getMeta('settings')) this.setMeta('settings', defaultSettings);
    if (!this.getMeta('revision')) this.setMeta('revision', 1);
    this.limit = limit; this.mode = mode;
    this.collector = { mode, status: mode === 'paused' ? 'paused' : 'waiting_for_auth', lastReceivedAt: this.getMeta('lastReceivedAt') || null, message: mode === 'paused' ? 'Collection paused. Complete server setup to begin.' : 'Waiting for collection setup.' };
  }
  close() { this.db.close(); }
  getMeta(key) { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key, JSON.stringify(value)); }
  bump() { this.setMeta('revision', (this.getMeta('revision') || 0) + 1); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  vehicle(id) { const row = this.db.prepare('SELECT payload FROM vehicles WHERE id=?').get(id); return row ? JSON.parse(row.payload) : null; }
  putVehicle(vehicle) { this.db.prepare('INSERT OR REPLACE INTO vehicles(id,payload) VALUES(?,?)').run(vehicle.id, JSON.stringify(vehicle)); }
  putRecord(kind, record, { replace = true } = {}) {
    if (!kinds.includes(kind)) throw new Error('Unknown record type');
    const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
    this.db.prepare(`${verb} INTO records(kind,id,vehicle_id,occurred_at,payload) VALUES(?,?,?,?,?)`).run(kind, record.id, record.vehicleId, record.timestamp ?? record.startTime, JSON.stringify(record));
  }
  record(kind, id) { const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id); return row ? JSON.parse(row.payload) : null; }
  records(kind) { return this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY occurred_at DESC,id').all(kind).map(row => JSON.parse(row.payload)); }
  getRuntime(id) { const row = this.db.prepare('SELECT payload FROM runtime WHERE vehicle_id=?').get(id); return row ? JSON.parse(row.payload) : null; }
  putRuntime(id, value) { this.db.prepare('INSERT OR REPLACE INTO runtime(vehicle_id,payload) VALUES(?,?)').run(id, JSON.stringify(value)); }
  usage(now = Date.now()) {
    const month = new Date(now).toISOString().slice(0, 7);
    const row = this.db.prepare('SELECT * FROM usage WHERE month=?').get(month);
    return { month, estimatedCostUsd: row?.cost || 0, limitUsd: this.limit, requests: row?.requests || 0, signals: row?.signals || 0 };
  }
  reserveUsage({ requests = 0, signals = 0, cost = requests / 500 + signals / 150000 }, now = Date.now()) {
    return this.transaction(() => {
      const use = this.usage(now);
      if (use.estimatedCostUsd + cost > this.limit + 1e-10) return false;
      this.db.prepare('INSERT INTO usage(month,cost,requests,signals) VALUES(?,?,?,?) ON CONFLICT(month) DO UPDATE SET cost=cost+excluded.cost, requests=requests+excluded.requests, signals=signals+excluded.signals').run(use.month, cost, requests, signals);
      return true;
    });
  }
  status(status, message, receivedAt) {
    this.collector.status = status; this.collector.message = message;
    if (receivedAt) { this.collector.lastReceivedAt = receivedAt; this.setMeta('lastReceivedAt', receivedAt); }
  }
  snapshot(now = Date.now()) {
    const settings = this.getMeta('settings');
    const charges = this.records('charges').map(record => {
      const incomplete=record.incomplete??record.id.startsWith('legacy:');
      if (record.costSource === 'actual') return {...record,incomplete};
      const rate = record.ratePerKwh ?? (record.locationType === 'home' ? settings.homeRatePerKwh : null);
      const cost = rate !== null && record.energyKwh !== null ? Math.round(rate * record.energyKwh * 100) / 100 : null;
      // Keep the raw nullable override. Exporting an inherited effective tariff
      // would freeze it on restore or when editing an unrelated session field.
      return { ...record, incomplete, cost, ratePerKwh: record.ratePerKwh??null, costSource: cost === null ? 'unknown' : 'estimated' };
    });
    return { schemaVersion: 2, serverId: this.getMeta('serverId'), revision: this.getMeta('revision'), generatedAt: now, settings,
      vehicles: this.db.prepare('SELECT payload FROM vehicles ORDER BY id').all().map(row => JSON.parse(row.payload)),
      trips: this.records('trips'), charges, battery: this.records('battery'), idles: this.records('idles'),
      collector: { ...this.collector, usage: this.usage(now) } };
  }
  backup() {
    const allowed=['trips','chargeSessions','sleepRecords','batterySnapshots','dailyStats','lastState','quagoev_trip_history','quagoev_charge_history','quagoev_sleep_history','quagoev_battery_snapshots','quagoev_automations','quagoev_settings'];
    const legacyArchives=this.db.prepare('SELECT original FROM imports ORDER BY imported_at,digest').all().map(row=>JSON.parse(row.original)).filter(value=>value.schemaVersion!==2).map(value=>Object.fromEntries(allowed.filter(key=>key in value).map(key=>[key,value[key]])));
    return {...this.snapshot(),legacyArchives};
  }
  editSettings(input) { const patch = settingsPatch(input); this.transaction(() => { this.setMeta('settings', { ...this.getMeta('settings'), ...patch }); this.bump(); }); }
  editRecord(kind, id, input) {
    const patch = kind === 'trips' ? tripPatch(input) : chargePatch(input);
    const record = this.record(kind, id);
    if (!record) { const error = new ValidationError('Record not found'); error.status = 404; throw error; }
    if ('cost' in patch) patch.costSource = patch.cost === null ? 'unknown' : 'actual';
    this.transaction(() => { this.putRecord(kind, { ...record, ...patch }); this.bump(); });
  }
}
