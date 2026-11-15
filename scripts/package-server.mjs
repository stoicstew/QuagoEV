import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const label = `QuagoEV-Server-${packageInfo.version}`;
const output = path.join(root, 'release', 'server');
const destination = path.join(output, label);
await fs.access(path.join(root, 'dist', 'index.html')).catch(() => { throw new Error('Build the UI with npm run build before packaging the server.'); });
await fs.mkdir(output, { recursive: true });
await fs.rm(destination, { recursive: true, force: true });
await fs.mkdir(destination, { recursive: true });

const forbidden = /(?:^|\/)(?:node_modules|data|data-v2|keys|\.git|\.sessions\.json|\.env|server\.env|credentials\.encrypted)(?:$|\/)|\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)$/i;
async function copy(relative) {
  const source = path.join(root, relative);
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to package a symbolic link: ${relative}`);
  if (forbidden.test(relative)) throw new Error(`Refusing to package private data: ${relative}`);
  if (stat.isDirectory()) {
    await fs.mkdir(path.join(destination, relative), { recursive: true });
    for (const name of await fs.readdir(source)) {
      if (name.startsWith('.') || name.includes('.test.') || name === '__tests__') continue;
      await copy(`${relative}/${name}`);
    }
  } else if (stat.isFile()) {
    await fs.mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
    await fs.copyFile(source, path.join(destination, relative));
  }
}
for (const relative of ['package.json', 'package-lock.json', 'server', 'dist', 'scripts/server-setup.mjs', 'scripts/telemetry-bridge.mjs', 'scripts/windows', 'docs/WINDOWS_SERVER.md', 'docs/API_CONTRACT.md']) await copy(relative);
for (const relative of ['fixtures/demo-snapshot.json', 'docs/TELEMETRY.md', 'docs/VERIFICATION.md']) {
  try { await fs.access(path.join(root, relative)); await copy(relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const files = [];
async function inventory(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await inventory(path.join(directory, entry.name), relative);
    else {
      const bytes = await fs.readFile(path.join(directory, entry.name));
      files.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inventory(destination);
await fs.writeFile(path.join(destination, 'SERVER_MANIFEST.json'), JSON.stringify({ version: packageInfo.version, createdAt: new Date().toISOString(), nodeMinimum: 24, containsCredentials: false, files }, null, 2) + '\n');
const archive = path.join(output, `${label}.zip`);
await fs.rm(archive, { force: true });
let result;
if (process.platform === 'darwin') result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', destination, archive], { stdio: 'inherit' });
else if (process.platform === 'win32') {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -LiteralPath ${quote(destination)} -DestinationPath ${quote(archive)} -Force`], { stdio: 'inherit' });
} else result = spawnSync('zip', ['-q', '-r', archive, label], { cwd: output, stdio: 'inherit' });
if (result.error || result.status !== 0) throw new Error(`Archive creation failed; expanded bundle remains at ${destination}. ${result.error?.message || ''}`);
console.log(`Server bundle: ${archive}`);
console.log(`${files.length} source and UI files packaged; no user data, Tesla tokens or private keys included.`);
