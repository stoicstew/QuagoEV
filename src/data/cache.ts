import { validateSnapshot, type Snapshot } from './types';

const DATABASE = 'quagoev-v2';
const PROFILE = 'quagoev_v2_profile';
const TOKEN = 'quagoev_v2_credentials';
export interface Profile { serverUrl: string; serverId: string; cacheKey: string; }
export interface Credentials { serverUrl: string; token: string; }
declare global {
  interface Window {
    quagoev?: { credentials: { get(): Promise<Credentials | null>; set(value: Credentials): Promise<void>; clear(): Promise<void> } };
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Offline storage could not be opened.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', mode);
    const request = operation(tx.objectStore('snapshots'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(new Error('Offline storage could not be updated.')); };
    tx.onabort = () => { db.close(); reject(new Error('Offline storage update was interrupted.')); };
  });
}
export async function loadCache(profile: Profile): Promise<Snapshot | null> {
  const value: unknown = await transaction('readonly', store => store.get(profile.cacheKey));
  if (!value) return null;
  const snapshot = validateSnapshot(value);
  return snapshot.serverId === profile.serverId ? snapshot : null;
}
export async function saveCache(profile: Profile, snapshot: Snapshot) { await transaction('readwrite', store => store.put(snapshot, profile.cacheKey)); }
export async function clearCache(profile: Profile) { await transaction('readwrite', store => store.delete(profile.cacheKey)); }
export async function clearAllCaches() { await transaction('readwrite', store => store.clear()); }
export function getProfile(): Profile | null {
  try { const p = JSON.parse(localStorage.getItem(PROFILE) || 'null'); return p && typeof p.serverUrl === 'string' && typeof p.serverId === 'string' && typeof p.cacheKey === 'string' ? p : null; } catch { return null; }
}
export function putProfile(profile: Profile | null) { profile ? localStorage.setItem(PROFILE, JSON.stringify(profile)) : localStorage.removeItem(PROFILE); }
export async function getCredentials(): Promise<Credentials | null> {
  if (window.quagoev) return window.quagoev.credentials.get();
  try { const c = JSON.parse(sessionStorage.getItem(TOKEN) || 'null'); return c && typeof c.serverUrl === 'string' && typeof c.token === 'string' ? c : null; } catch { return null; }
}
let credentialWrite: Promise<void> = Promise.resolve();
export function putCredentials(credentials: Credentials | null): Promise<void> {
  // Serialize native IPC writes, so a delayed connect can never restore a key
  // after the user has asked to forget it.
  const write = credentialWrite.catch(() => {}).then(async () => {
    if (window.quagoev) { await (credentials ? window.quagoev.credentials.set(credentials) : window.quagoev.credentials.clear()); return; }
    credentials ? sessionStorage.setItem(TOKEN, JSON.stringify(credentials)) : sessionStorage.removeItem(TOKEN);
  });
  credentialWrite = write;
  return write;
}
export function normaliseServerUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete server address, such as https://quagoev.example.ts.net.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Use HTTPS for your server. HTTP is allowed only on localhost.');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Use the server address only, without a path, password or query.');
  return url.origin;
}
