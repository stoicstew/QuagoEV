// Run with: node_modules/.bin/electron electron/runtime.test.cjs
// Uses an isolated temporary profile and synthetic credentials only.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quagoev-electron-test-'));
process.env.QUAGOEV_USER_DATA_DIR = temp;
require('./main.cjs');
const timer = setTimeout(() => { console.error('Electron smoke test timed out.'); app.exit(1); }, 25000);
app.whenReady().then(async () => {
  try {
    let window;
    for (let i = 0; i < 100; i++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoading()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(window, 'window created');
    assert.equal(window.webContents.getURL(), 'quagoev://app/');
    const flags = await window.webContents.executeJavaScript('({ node: typeof process, bridge: typeof window.quagoev?.credentials?.get })');
    assert.equal(flags.node, 'undefined');
    assert.equal(flags.bridge, 'function');
    const sample = { serverUrl: 'https://quagoev-test.example', token: 'synthetic-test-access-key-not-a-real-key' };
    await window.webContents.executeJavaScript(`window.quagoev.credentials.set(${JSON.stringify(sample)})`);
    const saved = await window.webContents.executeJavaScript('window.quagoev.credentials.get()');
    assert.deepEqual(saved, sample);
    const file = path.join(temp, 'credentials.encrypted');
    assert.ok(fs.existsSync(file));
    assert.equal(fs.readFileSync(file).includes(Buffer.from(sample.token)), false);
    await window.webContents.executeJavaScript('window.quagoev.credentials.clear()');
    assert.equal(fs.existsSync(file), false);
    assert.equal(await window.webContents.executeJavaScript('window.quagoev.credentials.get()'), null);
    console.log('Electron smoke passed: bundled origin, isolated renderer, encrypted credential roundtrip and forget.');
    clearTimeout(timer);
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error('Electron smoke failed:', error.message);
    clearTimeout(timer);
    app.exit(1);
  }
});
app.on('quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });
