const { app, BrowserWindow, ipcMain, protocol, safeStorage, session, shell, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateCredentials, isAppUrl, assetPath, allowedNetworkUrl, allowedExternalUrl } = require('./security.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'quagoev', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true } }]);
if (process.env.QUAGOEV_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.QUAGOEV_USER_DATA_DIR));
let mainWindow;
let serverOrigin = null;
let credentialsFile;
let credentialQueue = Promise.resolve();
const assetDirectory = path.resolve(__dirname, '..', 'dist');
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'";
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function requireEncryption() {
  const available = typeof safeStorage.isAsyncEncryptionAvailable === 'function' ? await safeStorage.isAsyncEncryptionAvailable() : safeStorage.isEncryptionAvailable();
  if (!available || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')) throw new Error('OS credential storage is unavailable. Unlock your system keychain and try again.');
}
async function readCredentials() {
  let encrypted;
  try { encrypted = await fs.readFile(credentialsFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  await requireEncryption();
  const decrypted = typeof safeStorage.decryptStringAsync === 'function' ? await safeStorage.decryptStringAsync(encrypted) : safeStorage.decryptString(encrypted);
  const plain = typeof decrypted === 'string' ? decrypted : decrypted.result;
  const saved = validateCredentials(JSON.parse(plain));
  if (decrypted?.shouldReEncrypt) await writeCredentials(saved);
  serverOrigin = saved.serverUrl;
  return saved;
}
async function writeCredentials(input) {
  const value = validateCredentials(input);
  await requireEncryption();
  const encrypted = typeof safeStorage.encryptStringAsync === 'function' ? await safeStorage.encryptStringAsync(JSON.stringify(value)) : safeStorage.encryptString(JSON.stringify(value));
  await fs.mkdir(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
  const temporary = `${credentialsFile}.tmp`;
  await fs.writeFile(temporary, encrypted, { mode: 0o600 });
  await fs.rename(temporary, credentialsFile);
  serverOrigin = value.serverUrl;
}
function checkSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('Untrusted credential request.');
}
function serializeCredentialOperation(operation) {
  const result = credentialQueue.then(operation);
  credentialQueue = result.catch(() => {});
  return result;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 850, minWidth: 380, minHeight: 540, title: 'QuagoEV', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL('quagoev://app/');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    credentialsFile = path.join(app.getPath('userData'), 'credentials.encrypted');
    // Credential failures do not block cached history or the connection screen.
    try { await readCredentials(); } catch { /* The UI can display a targeted error when it asks for credentials. */ }
    protocol.handle('quagoev', async request => {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      let filePath = assetPath(request.url, assetDirectory);
      if (!filePath) return new Response('Not found', { status: 404 });
      if (!path.extname(filePath)) filePath = path.join(assetDirectory, 'index.html');
      try {
        const bytes = await fs.readFile(filePath);
        return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedNetworkUrl(details.url, serverOrigin) }));
    ipcMain.handle('quagoev:credentials:get', async event => { checkSender(event); return serializeCredentialOperation(readCredentials); });
    ipcMain.handle('quagoev:credentials:set', async (event, input) => { checkSender(event); return serializeCredentialOperation(() => writeCredentials(input)); });
    ipcMain.handle('quagoev:credentials:clear', async event => {
      checkSender(event);
      return serializeCredentialOperation(async () => {
        serverOrigin = null;
        await fs.rm(credentialsFile, { force: true });
        await fs.rm(`${credentialsFile}.tmp`, { force: true });
      });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { console.error('QuagoEV could not start:', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
