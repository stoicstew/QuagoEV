import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(new URL('../fixtures/demo-snapshot.json', import.meta.url), 'utf8'));

const api = 'https://quagoev.test';
const token = 'test-server-access-key-which-is-not-a-tesla-token';
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,POST,OPTIONS' };
function fixture() { const s = structuredClone(raw); s.serverId = 'test-personal-server'; s.vehicles[0].name = 'My real cache fixture'; return s; }
async function connect(page: Page) {
  await page.getByLabel('Home server address').fill(api);
  await page.getByLabel('Server access key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Connect to server', exact: true }).click();
  await expect(page.getByText('Server connected', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Date range').selectOption('all');
}
async function cacheCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('quagoev-v2', 1);
    open.onsuccess = () => { const db = open.result; const req = db.transaction('snapshots').objectStore('snapshots').count(); req.onsuccess = () => { resolve(req.result); db.close(); }; req.onerror = () => reject(req.error); };
    open.onerror = () => reject(open.error);
  }));
}

test('sample navigation, route detail, reports and responsive layouts have no runtime errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/quagoev-desktop-overview.png', fullPage: true });
  for (const name of ['Drives', 'Charging', 'Battery', 'Insights', 'Settings']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Drives', exact: true }).click();
  await page.getByRole('button', { name: /Open drive on/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save drive' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('quagoev-drives.csv');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.waitForTimeout(300); // Chart.js resize observer settles before capture.
  await page.screenshot({ path: 'test-results/quagoev-narrow-overview.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  for (const name of ['Drives', 'Charging', 'Battery', 'Insights', 'Settings']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test('server auth, edits, safe CSV, offline relaunch, demo isolation and forget', async ({ page }) => {
  let snapshot = fixture(); let unavailable = false; const requests: string[] = [];
  await page.route(`${api}/**`, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push(new URL(req.url()).pathname);
    expect(req.headers().authorization).toBe(`Bearer ${token}`);
    if (unavailable) return route.abort();
    if (req.url().endsWith('/auth/status')) return route.fulfill({ headers, json: { configured: false, authenticated: false } });
    if (req.method() === 'PATCH') { const id = decodeURIComponent(new URL(req.url()).pathname.split('/').at(-1)!); const trip = snapshot.trips.find(t => t.id === id)!; Object.assign(trip, req.postDataJSON()); snapshot.revision++; }
    return route.fulfill({ headers, json: snapshot });
  });
  await page.goto('/'); await connect(page);
  expect(await cacheCount(page)).toBe(1);
  expect(await page.evaluate(() => Object.values(localStorage).some(v => String(v).includes('test-server-access-key')))).toBeFalsy();
  await page.getByRole('button', { name: 'Drives', exact: true }).click();
  await page.getByRole('button', { name: /Open drive on/ }).first().click();
  await page.getByRole('dialog').getByLabel('Classification').selectOption('business');
  await page.getByLabel('Notes', { exact: true }).fill('=SUM(1,2)\nA "quoted" note');
  await page.getByRole('button', { name: 'Save drive' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV' }).click();
  const path = await (await downloaded).path(); const csv = await fs.readFile(path!, 'utf8');
  expect(csv).toContain('"\'=SUM(1,2)\nA ""quoted"" note"');
  expect(csv).toContain('Distance (km)');
  // Simulate a server outage, while bundled/client assets remain available.
  unavailable = true; await page.reload();
  await expect(page.getByRole('heading', { name: 'My real cache fixture', exact: true })).toBeVisible();
  await expect(page.getByText('Saved history', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const backup = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const saved = JSON.parse(await fs.readFile((await (await backup).path())!, 'utf8'));
  expect(saved.serverId).toBe('test-personal-server'); expect(saved.trips.length).toBe(snapshot.trips.length);
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByText('Sample data', { exact: true }).first()).toBeVisible();
  expect(await cacheCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My real cache fixture', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Forget server…' }).click();
  await page.getByRole('button', { name: 'Forget server and local data' }).click();
  await expect(page.getByText('Not connected', { exact: true }).first()).toBeVisible();
  expect(await cacheCount(page)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('quagoev_v2_credentials'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('quagoev_v2_profile'))).toBeNull();
  expect(requests.every(path => path.startsWith('/api/v2/') || path === '/auth/status')).toBeTruthy();
});

test('invalid schema and auth preserve cached data; successful empty snapshot replaces it', async ({ page }) => {
  let response: unknown = fixture(); let code = 200;
  await page.route(`${api}/**`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: code, headers, json: response });
  });
  await page.goto('/'); await connect(page);
  response = { schemaVersion: 2, serverId: 'broken' };
  await page.getByRole('button', { name: 'Sync saved data from server' }).click();
  await expect(page.getByRole('status')).toContainText('incompatible');
  await expect(page.getByRole('heading', { name: 'My real cache fixture', exact: true })).toBeVisible();
  response = { error: 'unauthorised' }; code = 401;
  await page.getByRole('button', { name: 'Sync saved data from server' }).click();
  await expect(page.getByText('Access key needed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My real cache fixture', exact: true })).toBeVisible();
  const empty = fixture(); empty.trips = []; empty.charges = []; empty.battery = []; empty.idles = []; empty.vehicles = []; empty.revision++;
  response = empty; code = 200;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Server access key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Connect to server', exact: true }).click();
  await expect(page.getByText('Server connected', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Drives', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No drives match this view' })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Drives', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No drives match this view' })).toBeVisible();
});

test('remote HTTP is rejected before sending the access key', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('request', req => { if (req.url().startsWith('http://unsafe.test')) unexpected.push(req.url()); });
  await page.goto('/');
  await page.getByLabel('Home server address').fill('http://unsafe.test');
  await page.getByLabel('Server access key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Connect to server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Use HTTPS');
  expect(unexpected).toEqual([]);
});

test('forget wins over a delayed native credential write during reconnect', async ({ page }) => {
  await page.addInitScript(() => {
    let credentials: { serverUrl: string; token: string } | null = null;
    (window as unknown as { nativeTestValue: () => unknown }).nativeTestValue = () => credentials;
    (window as unknown as { quagoev: unknown }).quagoev = { credentials: {
      get: async () => credentials,
      set: async (value: { serverUrl: string; token: string }) => {
        if (value.token === 'delayed-new-key') await new Promise(resolve => setTimeout(resolve, 400));
        credentials = value;
      },
      clear: async () => { credentials = null; },
    } };
  });
  const paths: string[] = [];
  await page.route(`${api}/**`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    paths.push(route.request().headers().authorization ?? '');
    return route.fulfill({ headers, json: route.request().url().endsWith('/auth/status') ? { configured: false, authenticated: false } : fixture() });
  });
  await page.goto('/'); await connect(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Server access key', { exact: true }).fill('delayed-new-key');
  await page.getByRole('button', { name: 'Connect to server', exact: true }).click();
  await page.getByRole('button', { name: 'Forget server…' }).click();
  await page.getByRole('button', { name: 'Forget server and local data' }).click();
  await expect(page.getByText('Not connected', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { nativeTestValue: () => unknown }).nativeTestValue())).toBeNull();
  expect(await cacheCount(page)).toBe(0);
  expect(paths).not.toContain('Bearer delayed-new-key');
});
