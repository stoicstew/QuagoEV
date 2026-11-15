import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargeCost, dayKey, inPeriod, tripTotals, tripsCsv } from '../src/data/format.ts';
import { validateSnapshot } from '../src/data/types.ts';

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/demo-snapshot.json', import.meta.url), 'utf8'));

test('efficiency is distance weighted and unknown energy does not become zero', () => {
  const stats = tripTotals([
    { distanceKm: 10, energyKwh: 1, incomplete: false },
    { distanceKm: 100, energyKwh: 20, incomplete: false },
    { distanceKm: 80, energyKwh: null, incomplete: true },
    { distanceKm: 0, energyKwh: 0.5, incomplete: false },
  ]);
  assert.equal(stats.distance, 190);
  assert.equal(stats.energy, 21.5);
  assert.equal(stats.efficiency, 21 * 1000 / 110);
  assert.equal(stats.knownCount, 3);
  assert.equal(stats.incomplete, 1);
  assert.equal(tripTotals([{ distanceKm: 10, energyKwh: null }]).energy, null);
  assert.equal(tripTotals([{ distanceKm: 0, energyKwh: 0 }]).efficiency, null);
});

test('Melbourne date filters use local calendar boundaries instead of UTC or fixed elapsed hours', () => {
  const now = Date.parse('2026-11-07T02:00:00Z');
  const first = Date.parse('2026-10-31T13:00:00Z');
  assert.equal(dayKey(first, 'Australia/Melbourne'), '2026-11-01');
  assert.equal(inPeriod(first, '7', now, 'Australia/Melbourne'), true);
  assert.equal(inPeriod(first - 1, '7', now, 'Australia/Melbourne'), false);
  assert.equal(inPeriod(Date.parse('2026-11-07T13:00:00Z'), '7', now, 'Australia/Melbourne'), false);
  const dstSunday = Date.parse('2026-10-04T01:00:00Z');
  assert.equal(dayKey(dstSunday, 'Australia/Melbourne'), '2026-10-04');
  assert.equal(inPeriod(Date.parse('2026-09-27T14:00:00Z'), '7', dstSunday, 'Australia/Melbourne'), true);
});

test('cost calculation preserves free sessions, unknown locations and explicit actual amounts', () => {
  const base = { energyKwh: 20, ratePerKwh: null, cost: null, costSource: 'unknown', locationType: 'home' };
  assert.deepEqual(chargeCost(base, null), { cost: null, source: 'unknown' });
  assert.deepEqual(chargeCost(base, 0), { cost: 0, source: 'estimated' });
  assert.deepEqual(chargeCost({ ...base, locationType: 'unknown' }, 0.29), { cost: null, source: 'unknown' });
  assert.deepEqual(chargeCost({ ...base, cost: 0, costSource: 'actual', ratePerKwh: 0.5 }, 0.29), { cost: 0, source: 'actual' });
  assert.deepEqual(chargeCost({ ...base, ratePerKwh: 0.4 }, 0.29), { cost: 8, source: 'estimated' });
});

test('CSV has ISO timestamps and quotes formula-shaped notes, commas and line breaks', () => {
  const snapshot = fixture();
  snapshot.trips[0].notes = '  =HYPERLINK("test", "click")\nsecond line';
  const csv = tripsCsv([snapshot.trips[0]], snapshot);
  assert.ok(csv.includes(new Date(snapshot.trips[0].startTime).toISOString()));
  assert.ok(csv.includes('"\'  =HYPERLINK(""test"", ""click"")\nsecond line"'));
});

test('malformed snapshots cannot replace valid local history', () => {
  assert.equal(validateSnapshot(fixture()).schemaVersion, 2);
  const invalid = fixture(); invalid.trips[0].distanceKm = null;
  assert.throws(() => validateSnapshot(invalid), /invalid drive/);
  const wrongZone = fixture(); wrongZone.settings.timeZone = 'not-a-zone';
  assert.throws(() => validateSnapshot(wrongZone), /timezone/);
  const brokenRoute = fixture(); brokenRoute.trips[0].route[0].lat = 101;
  assert.throws(() => validateSnapshot(brokenRoute), /drive/);
});
