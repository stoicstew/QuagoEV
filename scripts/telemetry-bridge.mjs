import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { normalizeTelemetryRecord } from '../server/telemetry-normalize.js';

const MAX_LINE_BYTES = 1024 * 1024;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export function ingestUrl(value = 'http://127.0.0.1:3001/internal/observations') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.pathname !== '/internal/observations' || url.search || url.hash || url.username || url.password) throw new Error('The telemetry bridge only sends to the local QuagoEV ingest endpoint.');
  return url.toString();
}
async function sourceStamp(file, prefixLength) {
  const stat = await file.stat();
  const count = prefixLength ?? Math.min(4096, stat.size);
  const prefix = Buffer.alloc(count);
  const { bytesRead } = await file.read(prefix, 0, count, 0);
  return { identity: `${stat.dev}:${stat.ino}`, size: stat.size, prefixLength: count, prefixHash: crypto.createHash('sha256').update(prefix.subarray(0, bytesRead)).digest('hex') };
}
async function saveCheckpoint(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value) + '\n', { mode: 0o600 });
  await fs.rename(temp, filename);
}

/** Replay complete newline-delimited records from the last acknowledged offset.
 * The checkpoint advances only after a 2xx ingest result or a non-vehicle log.
 */
export async function replayFile({ filename, checkpoint, url, token, fetchImpl = fetch }) {
  const file = await fs.open(filename, 'r');
  try {
    let saved = null;
    try { saved = JSON.parse(await fs.readFile(checkpoint, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid checkpoint. Preserve it and inspect the input before restarting.'); }
    const stamp = await sourceStamp(file, saved?.prefixLength);
    if (saved && (saved.source !== path.resolve(filename) || saved.identity !== stamp.identity || saved.offset > stamp.size || saved.prefixHash !== stamp.prefixHash)) throw new Error('Telemetry log was replaced or truncated. Replay the previous log before creating a new checkpoint.');
    let offset = saved?.offset ?? 0, records = 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid checkpoint offset.');
    while (offset < stamp.size) {
      const buffer = Buffer.alloc(Math.min(MAX_LINE_BYTES + 1, stamp.size - offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      const newline = buffer.subarray(0, bytesRead).indexOf(10);
      if (newline === -1) {
        if (bytesRead > MAX_LINE_BYTES) throw new Error('Telemetry log line exceeds the supported size.');
        break; // A partial last line is left unacknowledged for the next pass.
      }
      if (newline > MAX_LINE_BYTES) throw new Error('Telemetry log line exceeds the supported size.');
      const line = buffer.subarray(0, newline).toString('utf8').trim();
      let normalized = null;
      if (line) {
        let record;
        try { record = JSON.parse(line); } catch { throw new Error('Invalid JSON at the current log offset. Check UTF-8 logger configuration.'); }
        normalized = normalizeTelemetryRecord(record);
      }
      if (normalized) {
        let response;
        try { response = await fetchImpl(url, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify(normalized), signal:AbortSignal.timeout(10000), redirect:'error' }); }
        catch { const error = new Error('QuagoEV ingest is unreachable; the checkpoint was preserved.'); error.retryable = true; throw error; }
        if (!response.ok) {
          const error = new Error(`QuagoEV ingest rejected a record (HTTP ${response.status}); the checkpoint was preserved. Stopping this bridge does not stop Tesla streaming or billing.`);
          // This local endpoint uses 429 for a budget pause. Retrying it cannot
          // stop the billable source stream, so surface it as an operator action.
          error.retryable = response.status >= 500;
          throw error;
        }
        records++;
      }
      offset += newline + 1;
      const currentStamp = await sourceStamp(file);
      saved = { version:1, source:path.resolve(filename), identity:currentStamp.identity, offset, prefixLength:currentStamp.prefixLength, prefixHash:currentStamp.prefixHash };
      await saveCheckpoint(checkpoint, saved);
    }
    return { records, offset };
  } finally { await file.close(); }
}
async function acquireLock(checkpoint) {
  const lock = `${checkpoint}.lock`;
  await fs.mkdir(path.dirname(lock), { recursive:true, mode:0o700 });
  try { await fs.writeFile(lock, String(process.pid), { flag:'wx', mode:0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lock,'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Bridge lock is invalid; inspect it before restarting.');
    let running = true;
    try { process.kill(pid,0); } catch (status) { if (status.code === 'ESRCH') running = false; }
    if (running) throw new Error('Another bridge may already be running for this checkpoint.');
    await fs.unlink(lock);
    await fs.writeFile(lock, String(process.pid), { flag:'wx', mode:0o600 });
  }
  return () => fs.rm(lock,{force:true});
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/telemetry-bridge.mjs --file LOG.jsonl --checkpoint CHECKPOINT.json [--once]\nLoad QUAGOEV_TELEMETRY_TOKEN via protected environment/config. The API must be explicitly configured for verified telemetry.'); return; }
  const options = {};
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--once') options.once = true;
    else if (['--file','--checkpoint'].includes(args[i]) && args[i+1]) options[args[i++].slice(2)] = args[i];
    else throw new Error('Unknown or incomplete bridge argument. Use --help.');
  }
  if (!options.file || !options.checkpoint) throw new Error('Specify --file and --checkpoint.');
  const token = process.env.QUAGOEV_TELEMETRY_TOKEN;
  if (typeof token !== 'string' || token.length < 32) throw new Error('QUAGOEV_TELEMETRY_TOKEN is missing or too short.');
  const url = ingestUrl(process.env.QUAGOEV_INGEST_URL);
  const release = await acquireLock(path.resolve(options.checkpoint));
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log('Telemetry bridge started. No vehicle configuration or billing setting was changed.');
  try {
    do {
      try { const result = await replayFile({ filename:path.resolve(options.file), checkpoint:path.resolve(options.checkpoint), url, token }); if (result.records) console.log(`Accepted ${result.records} telemetry records.`); }
      catch (error) { if (options.once || !error.retryable) throw error; console.error(error.message); }
      if (!options.once && !stopped) await wait(2000);
    } while (!options.once && !stopped);
  } finally { await release(); process.off('SIGINT',stop); process.off('SIGTERM',stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
