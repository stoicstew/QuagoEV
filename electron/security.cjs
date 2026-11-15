const path = require('node:path');

function canonicalServerUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a valid server URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid server URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Use HTTPS for a remote server.');
  if (url.username || url.password || url.hash || url.search || !['', '/'].includes(url.pathname)) throw new Error('Use only the server address, without a path, password or query.');
  return url.origin;
}

function validateCredentials(input) {
  if (!input || typeof input !== 'object' || typeof input.token !== 'string' || input.token.trim().length < 16 || input.token.length > 4096 || /\s/.test(input.token)) throw new Error('Enter the server access key from your Windows server.');
  return { serverUrl: canonicalServerUrl(input.serverUrl), token: input.token };
}

function isAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'quagoev:' && url.hostname === 'app' && !url.username && !url.password && !url.port; } catch { return false; }
}

function assetPath(value, directory) {
  if (!isAppUrl(value)) return null;
  let pathname;
  try { pathname = decodeURIComponent(new URL(value).pathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..')) return null;
  const resolved = path.resolve(directory, `.${pathname}`);
  const relative = path.relative(directory, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function allowedNetworkUrl(value, serverOrigin) {
  if (isAppUrl(value)) return true;
  if (value.startsWith('blob:quagoev://app/')) return true;
  try { const url = new URL(value); return !!serverOrigin && url.origin === serverOrigin && !url.username && !url.password && ['https:', 'http:'].includes(url.protocol); } catch { return false; }
}

function allowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && ['developer.tesla.com', 'auth.tesla.com', 'www.tesla.com', 'tesla.com', 'tailscale.com', 'github.com'].includes(url.hostname);
  } catch { return false; }
}

module.exports = { canonicalServerUrl, validateCredentials, isAppUrl, assetPath, allowedNetworkUrl, allowedExternalUrl };
