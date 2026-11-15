import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { clearAllCaches, clearCache, getCredentials, getProfile, loadCache, normaliseServerUrl, putCredentials, putProfile, saveCache, type Credentials, type Profile } from '../data/cache';
import { demoSnapshot } from '../data/demo';
import { validateSnapshot, type Snapshot } from '../data/types';

type ConnectionStatus = 'starting' | 'syncing' | 'connected' | 'offline' | 'auth' | 'disconnected';
interface DataContextValue {
  snapshot: Snapshot | null; profile: Profile | null; mode: 'server' | 'demo';
  status: ConnectionStatus; error: string | null; storageWarning: string | null;
  syncedAt: number | null; busy: boolean; ready: boolean;
  connect(url: string, token: string): Promise<void>;
  refresh(): Promise<void>;
  mutate(path: string, body: unknown, method?: 'PATCH' | 'POST'): Promise<void>;
  teslaAuth(action: 'status' | 'login'): Promise<{ authenticated?: boolean; configured?: boolean; collectorMode?: string; url?: string }>;
  forget(): Promise<void>; enterDemo(): void; exitDemo(): Promise<void>;
}
const DataContext = createContext<DataContextValue>(null!);
export const useData = () => useContext(DataContext);

class AuthError extends Error {}
async function request(credentials: Credentials, path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
  const response = await fetch(`${credentials.serverUrl}${path}`, {
    method, signal, cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${credentials.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) throw new AuthError('The server access key was not accepted. Your saved history is still available.');
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Server request failed (${response.status}).`);
  }
  return validateSnapshot(await response.json());
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [profile, setProfile] = useState<Profile | null>(getProfile);
  const [status, setStatus] = useState<ConnectionStatus>('starting');
  const [mode, setMode] = useState<'server' | 'demo'>('server');
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const credentialsRef = useRef<Credentials | null>(null);
  const profileRef = useRef(profile);
  const epoch = useRef(0);
  const active = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const modeRef = useRef(mode);

  const cancel = useCallback(() => { epoch.current += 1; active.current?.abort(); active.current = null; busyRef.current = false; setBusy(false); }, []);
  const begin = useCallback(() => {
    cancel(); const generation = epoch.current; const controller = new AbortController();
    active.current = controller; busyRef.current = true; setBusy(true); setStatus('syncing'); setError(null);
    const timer = setTimeout(() => controller.abort(), 15_000);
    return { generation, signal: controller.signal, finish: () => { clearTimeout(timer); if (epoch.current === generation) { busyRef.current = false; setBusy(false); active.current = null; } } };
  }, [cancel]);
  const accept = useCallback(async (value: Snapshot, p: Profile, generation: number) => {
    if (epoch.current !== generation) return;
    if (value.serverId !== p.serverId) throw new Error('This address now belongs to a different server. Reconnect explicitly before replacing saved data.');
    await saveCache(p, value).then(() => { if (epoch.current === generation) setStorageWarning(null); }).catch(() => { if (epoch.current === generation) setStorageWarning('Data is visible, but offline storage could not be updated. Export a backup before closing.'); });
    if (epoch.current !== generation) return;
    setSnapshot(value); setSyncedAt(Date.now()); setStatus('connected'); setError(null);
  }, []);
  const failure = useCallback((err: unknown, generation: number) => {
    if (epoch.current !== generation) return;
    setStatus(err instanceof AuthError ? 'auth' : 'offline');
    setError(err instanceof DOMException && err.name === 'AbortError' ? 'The server did not respond in time. Showing saved data.' : err instanceof Error ? err.message : 'The server is unavailable. Showing saved data.');
  }, []);
  const refresh = useCallback(async () => {
    const p = profileRef.current; const credentials = credentialsRef.current;
    if (busyRef.current || modeRef.current === 'demo' || !p || !credentials) return;
    const op = begin();
    try { const value = await request(credentials, '/api/v2/snapshot', op.signal); await accept(value, p, op.generation); }
    catch (err) { failure(err, op.generation); }
    finally { op.finish(); }
  }, [accept, begin, failure]);

  useEffect(() => {
    let cancelled = false;
    const p = getProfile(); profileRef.current = p;
    (async () => {
      try {
        if (p) {
          const cached = await loadCache(p);
          if (cancelled) return;
          setSnapshot(cached); setSyncedAt(cached?.generatedAt ?? null);
        }
        const credentials = await getCredentials();
        if (cancelled) return;
        credentialsRef.current = p && credentials?.serverUrl === p.serverUrl ? credentials : null;
        setStatus(p ? (credentialsRef.current ? 'offline' : 'auth') : 'disconnected');
        if (p && !credentialsRef.current) setError('Enter your server access key to sync. Saved history remains available.');
      } catch { if (!cancelled) { setStatus('disconnected'); setError('Could not load your connection. Reconnect to your server.'); } }
      if (!cancelled) { setReady(true); void refresh(); }
    })();
    return () => { cancelled = true; cancel(); };
  }, [cancel, refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); }, 60_000);
    const online = () => { void refresh(); };
    const offline = () => { if (modeRef.current !== 'demo' && profileRef.current) { cancel(); setStatus('offline'); setError('This device is offline. Showing your saved history.'); } };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [cancel, refresh]);

  const connect = async (url: string, key: string) => {
    if (busyRef.current) throw new Error('Wait for the current request to finish.');
    const serverUrl = normaliseServerUrl(url);
    const token = key.trim();
    if (!token) throw new Error('Enter the QuagoEV server access key.');
    const credentials = { serverUrl, token }; const previous = credentialsRef.current;
    const op = begin();
    try {
      // Electron allows network requests only to the saved server origin.
      await putCredentials(credentials);
      if (epoch.current !== op.generation) throw new DOMException('Connection cancelled.', 'AbortError');
      const value = await request(credentials, '/api/v2/snapshot', op.signal);
      if (epoch.current !== op.generation) throw new DOMException('Connection cancelled.', 'AbortError');
      const oldProfile = profileRef.current;
      const p: Profile = oldProfile?.serverId === value.serverId && oldProfile.serverUrl === serverUrl ? oldProfile : { serverUrl, serverId: value.serverId, cacheKey: crypto.randomUUID() };
      putProfile(p); profileRef.current = p; credentialsRef.current = credentials; setProfile(p);
      modeRef.current = 'server'; setMode('server');
      await accept(value, p, op.generation);
      if (oldProfile && oldProfile.cacheKey !== p.cacheKey) await clearCache(oldProfile).catch(() => { if (epoch.current === op.generation) setStorageWarning('Connected, but the previous server’s offline cache could not be removed. Forget this server to clear all local history.'); });
    } catch (err) {
      if (epoch.current === op.generation) { await putCredentials(previous).catch(() => {}); failure(err, op.generation); }
      throw err;
    } finally { op.finish(); }
  };
  const mutate = async (path: string, body: unknown, method: 'PATCH' | 'POST' = 'PATCH') => {
    if (modeRef.current === 'demo') throw new Error('Connect to your server to edit real records.');
    if (status !== 'connected' || !credentialsRef.current || !profileRef.current || busyRef.current) throw new Error('Connect to your server before saving changes.');
    const op = begin();
    try { await accept(await request(credentialsRef.current, path, op.signal, method, body), profileRef.current, op.generation); }
    catch (err) { failure(err, op.generation); throw err; }
    finally { op.finish(); }
  };
  const forget = async () => {
    cancel();
    busyRef.current = true; setBusy(true); credentialsRef.current = null;
    try {
      await putCredentials(null);
      await clearAllCaches();
      putProfile(null); profileRef.current = null; setProfile(null); setSnapshot(null); setSyncedAt(null);
      modeRef.current = 'server'; setMode('server'); setStatus('disconnected'); setError(null); setStorageWarning(null);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const teslaAuth = useCallback(async (action: 'status' | 'login') => {
    const credentials = credentialsRef.current;
    if (!credentials || modeRef.current === 'demo') throw new Error('Connect to your home server first.');
    const response = await fetch(`${credentials.serverUrl}/auth/${action}`, { headers: { Authorization: `Bearer ${credentials.token}` }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Tesla connection could not be prepared. Check your server connection and setup.');
    const data = await response.json();
    if (action === 'login') {
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 'auth.tesla.com') throw new Error('The server returned an unexpected Tesla sign-in address.');
    }
    return data;
  }, []);
  const enterDemo = () => { if (busyRef.current) return; cancel(); modeRef.current = 'demo'; setMode('demo'); setSnapshot(demoSnapshot()); setStatus('disconnected'); setError(null); setSyncedAt(null); };
  const exitDemo = async () => {
    cancel(); const generation = epoch.current; modeRef.current = 'server'; setMode('server'); setSnapshot(null);
    const p = profileRef.current;
    try { const cached = p ? await loadCache(p) : null; if (epoch.current !== generation) return; setSnapshot(cached); setSyncedAt(cached?.generatedAt ?? null); setStatus(p ? 'offline' : 'disconnected'); void refresh(); }
    catch { setStatus('disconnected'); setError('Saved data could not be loaded. Reconnect to your server.'); }
  };
  return <DataContext.Provider value={{ snapshot, profile, mode, status, error, storageWarning, syncedAt, busy, ready, connect, refresh, mutate, teslaAuth, forget, enterDemo, exitDemo }}>{children}</DataContext.Provider>;
}
