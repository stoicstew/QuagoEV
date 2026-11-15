const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { canonicalServerUrl, validateCredentials, isAppUrl, assetPath, allowedNetworkUrl, allowedExternalUrl } = require('./security.cjs');

test('remote credentials require an origin-only HTTPS URL', () => {
  assert.equal(canonicalServerUrl('https://laptop.tailnet.ts.net/'), 'https://laptop.tailnet.ts.net');
  assert.equal(canonicalServerUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  for (const url of ['http://laptop:3001', 'javascript:alert(1)', 'https://user:pass@laptop.ts.net', 'https://laptop.ts.net/api', 'https://laptop.ts.net?token=secret', 'https://laptop.ts.net/#token']) assert.throws(() => canonicalServerUrl(url));
  assert.throws(() => validateCredentials({ serverUrl: 'https://laptop.ts.net', token: 'short' }));
});
test('renderer network is limited to the selected server and bundled app', () => {
  const origin = 'https://laptop.tailnet.ts.net';
  assert.equal(allowedNetworkUrl('quagoev://app/assets/index.js', origin), true);
  assert.equal(allowedNetworkUrl(`${origin}/api/v2/snapshot`, origin), true);
  for (const url of ['https://attacker.example/api', 'https://laptop.tailnet.ts.net.attacker.example/', 'file:///etc/passwd', 'quagoev://attacker/index.html']) assert.equal(allowedNetworkUrl(url, origin), false);
  assert.equal(allowedNetworkUrl(`${origin}/api/v2/snapshot`, null), false);
});
test('asset paths reject encoded traversal and non-app authorities', () => {
  const base = path.resolve('dist');
  assert.equal(assetPath('quagoev://app/assets/main.js', base), path.join(base, 'assets/main.js'));
  for (const url of ['quagoev://app/%2e%2e%2fsecret', 'quagoev://app/%5c..%5csecret', 'quagoev://app/%00file', 'quagoev://user@app/index.html', 'file:///secret']) assert.equal(assetPath(url, base), null);
  assert.equal(isAppUrl('quagoev://app.evil/'), false);
});
test('external links cannot open executables or arbitrary sites', () => {
  assert.equal(allowedExternalUrl('https://tailscale.com/docs'), true);
  for (const url of ['file:///Applications/Terminal.app', 'https://tailscale.com.evil/', 'https://unknown.example', 'ms-settings:privacy']) assert.equal(allowedExternalUrl(url), false);
});
