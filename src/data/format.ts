import type { Charge, Snapshot, Trip } from './types';

export const number = (v: number | null | undefined, digits = 1) => v == null ? '—' : new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits }).format(v);
export const money = (v: number | null | undefined, currency = 'AUD') => v == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(v);
export function date(value: number, timeZone = 'Australia/Melbourne', options?: Intl.DateTimeFormatOptions) { return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', ...options, timeZone }).format(value); }
export const clock = (v: number, timeZone: string) => date(v, timeZone, { day: undefined, month: undefined, hour: 'numeric', minute: '2-digit' });
export function duration(start: number, end: number) { const minutes = Math.max(0, Math.round((end - start) / 60_000)); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
export function dayKey(value: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export type Period = '7' | '30' | '90' | 'all';
export function inPeriod(timestamp: number, period: Period, now: number, timeZone: string) {
  if (period === 'all') return true;
  const today = dayKey(now, timeZone);
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - Number(period) + 1);
  return dayKey(timestamp, timeZone) >= start.toISOString().slice(0, 10) && dayKey(timestamp, timeZone) <= today;
}
export function tripTotals(trips: Trip[]) {
  const known = trips.filter(t => t.energyKwh != null);
  const distance = trips.reduce((sum, t) => sum + t.distanceKm, 0);
  const complete = known.filter(t => !t.incomplete && t.distanceKm > 0);
  const knownDistance = complete.reduce((sum, t) => sum + t.distanceKm, 0);
  const completeEnergy = complete.reduce((sum, t) => sum + (t.energyKwh ?? 0), 0);
  const energy = known.reduce((sum, t) => sum + (t.energyKwh ?? 0), 0);
  return { distance, energy: known.length ? energy : null, efficiency: knownDistance ? completeEnergy * 1000 / knownDistance : null, knownCount: known.length, incomplete: trips.filter(t => t.incomplete).length };
}
export function chargeCost(charge: Charge, homeRate: number | null): { cost: number | null; source: string } {
  if (charge.cost != null) return { cost: charge.cost, source: charge.costSource };
  const rate = charge.ratePerKwh ?? (charge.locationType === 'home' ? homeRate : null);
  return rate != null && charge.energyKwh != null ? { cost: rate * charge.energyKwh, source: 'estimated' } : { cost: null, source: 'unknown' };
}
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function tripsCsv(trips: Trip[], snapshot: Snapshot): string {
  const rows: unknown[][] = [['Start (UTC)', 'End (UTC)', 'Vehicle', 'Distance (km)', 'Energy (kWh)', 'Energy source', 'Efficiency (Wh/km)', 'Tag', 'Notes', 'Incomplete']];
  for (const t of trips) rows.push([new Date(t.startTime).toISOString(), new Date(t.endTime).toISOString(), snapshot.vehicles.find(v => v.id === t.vehicleId)?.name ?? t.vehicleId, t.distanceKm, t.energyKwh, t.energySource, t.distanceKm > 0 && t.energyKwh != null ? t.energyKwh * 1000 / t.distanceKm : null, t.tag, t.notes, t.incomplete]);
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
export function download(content: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
