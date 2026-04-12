// Local storage helpers for persisting user settings and historical data

interface ChargeRecord {
  timestamp: number;
  batteryLevel: number;
  estimatedRange: number;
  idealRange: number;
  odometer: number;
}

interface TripRecord {
  id: string;
  startTime: number;
  endTime: number;
  startLocation: { lat: number; lng: number };
  endLocation: { lat: number; lng: number };
  distance: number;
  energyUsed: number;
  efficiency: number;
  startBattery: number;
  endBattery: number;
}

interface ElectricityRate {
  id: string;
  name: string;
  location: 'home' | 'work' | 'public';
  rate: number; // $/kWh
  touRates?: { startHour: number; endHour: number; rate: number }[];
}

interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: 'time' | 'location' | 'battery' | 'plugged_in';
    value: string;
  };
  condition?: {
    type: 'location' | 'day_of_week' | 'battery_level';
    value: string;
  };
  action: {
    type: 'notify' | 'climate_on' | 'climate_off' | 'charge_start' | 'charge_stop';
    params?: Record<string, unknown>;
  };
}

interface SleepRecord {
  date: string;
  totalParkedMinutes: number;
  totalAsleepMinutes: number;
  phantomDrainKwh: number;
  sentryModeActive: boolean;
  cabinOverheatActive: boolean;
}

interface AppSettings {
  electricityRates: ElectricityRate[];
  gasPricePerGallon: number;
  gasCarMpg: number;
  distanceUnit: 'mi' | 'km';
  tempUnit: 'F' | 'C';
  currency: string;
}

const KEYS = {
  CHARGE_HISTORY: 'quagoev_charge_history',
  TRIP_HISTORY: 'quagoev_trip_history',
  SLEEP_HISTORY: 'quagoev_sleep_history',
  AUTOMATIONS: 'quagoev_automations',
  SETTINGS: 'quagoev_settings',
  BATTERY_SNAPSHOTS: 'quagoev_battery_snapshots',
} as const;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, data: unknown): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// Charge history
export function getChargeHistory(): ChargeRecord[] {
  return load(KEYS.CHARGE_HISTORY, []);
}

export function addChargeRecord(record: ChargeRecord): void {
  const history = getChargeHistory();
  history.push(record);
  // Keep last 365 days
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  save(KEYS.CHARGE_HISTORY, history.filter((r) => r.timestamp > cutoff));
}

// Trip history
export function getTripHistory(): TripRecord[] {
  return load(KEYS.TRIP_HISTORY, []);
}

export function addTripRecord(record: TripRecord): void {
  const history = getTripHistory();
  history.push(record);
  save(KEYS.TRIP_HISTORY, history);
}

export function exportTripsToCSV(trips: TripRecord[]): string {
  const header = 'Date,Start Time,End Time,Distance (mi),Energy (kWh),Efficiency (Wh/mi),Start Battery %,End Battery %\n';
  const rows = trips.map((t) => {
    const date = new Date(t.startTime).toLocaleDateString();
    const start = new Date(t.startTime).toLocaleTimeString();
    const end = new Date(t.endTime).toLocaleTimeString();
    return `${date},${start},${end},${t.distance.toFixed(1)},${t.energyUsed.toFixed(2)},${t.efficiency.toFixed(0)},${t.startBattery},${t.endBattery}`;
  });
  return header + rows.join('\n');
}

// Sleep history
export function getSleepHistory(): SleepRecord[] {
  return load(KEYS.SLEEP_HISTORY, []);
}

export function addSleepRecord(record: SleepRecord): void {
  const history = getSleepHistory();
  history.push(record);
  save(KEYS.SLEEP_HISTORY, history);
}

// Automations
export function getAutomations(): AutomationRule[] {
  return load(KEYS.AUTOMATIONS, []);
}

export function saveAutomations(rules: AutomationRule[]): void {
  save(KEYS.AUTOMATIONS, rules);
}

// Settings
const DEFAULT_SETTINGS: AppSettings = {
  electricityRates: [
    { id: 'home', name: 'Home', location: 'home', rate: 0.12 },
    { id: 'work', name: 'Work', location: 'work', rate: 0.10 },
    { id: 'public', name: 'Public/Supercharger', location: 'public', rate: 0.35 },
  ],
  gasPricePerGallon: 3.50,
  gasCarMpg: 28,
  distanceUnit: 'mi',
  tempUnit: 'F',
  currency: 'USD',
};

export function getSettings(): AppSettings {
  return load(KEYS.SETTINGS, DEFAULT_SETTINGS);
}

export function saveSettings(settings: AppSettings): void {
  save(KEYS.SETTINGS, settings);
}

// Battery snapshots for degradation tracking
interface BatterySnapshot {
  timestamp: number;
  odometer: number;
  batteryLevel: number;
  estimatedRange: number;
  idealRange: number;
  maxRange: number; // calculated: idealRange / (batteryLevel / 100)
}

export function getBatterySnapshots(): BatterySnapshot[] {
  return load(KEYS.BATTERY_SNAPSHOTS, []);
}

export function addBatterySnapshot(snapshot: BatterySnapshot): void {
  const snapshots = getBatterySnapshots();
  // Only add one snapshot per day
  const today = new Date().toDateString();
  const lastSnapshot = snapshots[snapshots.length - 1];
  if (lastSnapshot && new Date(lastSnapshot.timestamp).toDateString() === today) {
    snapshots[snapshots.length - 1] = snapshot;
  } else {
    snapshots.push(snapshot);
  }
  save(KEYS.BATTERY_SNAPSHOTS, snapshots);
}

export type {
  ChargeRecord,
  TripRecord,
  ElectricityRate,
  AutomationRule,
  SleepRecord,
  AppSettings,
  BatterySnapshot,
};
