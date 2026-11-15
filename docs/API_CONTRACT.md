# QuagoEV personal server API v2

Implementation contract for desktop, native iOS and the Windows home server. The car integration is data-only. All dates below are Unix milliseconds (UTC); distances are kilometres, energy kWh and temperatures Celsius. Display dates using `settings.timeZone`.

## Client authentication and transport

Use HTTPS for remote servers (Tailscale private HTTPS is supported); plain HTTP is allowed only for localhost development. Each request sends `Authorization: Bearer <QUAGOEV_ACCESS_TOKEN>`. The token is the QuagoEV server access key, never a Tesla token. Native apps keep it in OS credential storage. Browser sessions keep it in memory/sessionStorage, not a durable plaintext token store. Missing/incorrect credentials return 401. Access to saved data does not depend on Tesla OAuth being valid.

`GET /healthz` returns `{ "status": "ok", "schemaVersion": 2 }`, without user data.

`GET /api/v2/snapshot` returns the full authoritative snapshot below. Reads never contact Tesla. Clients atomically replace their per-server cache after validating the response, and retain that cache on network/auth errors. Empty successful responses must replace old data; failed responses must not. `serverId` separates installations. Disconnect/forget must clear credentials and that profile's cached personal data. Demo data is isolated and labelled.

```ts
interface Snapshot {
  schemaVersion: 2;
  serverId: string;
  revision: number;
  generatedAt: number;
  settings: {
    currency: string; // AUD initially
    distanceUnit: 'km';
    temperatureUnit: 'C';
    timeZone: string; // Australia/Melbourne initially
    homeRatePerKwh: number | null; // unknown until supplied
    batteryCapacityKwh: number | null; // optional owner-supplied estimate
  };
  vehicles: Array<{
    id: string;
    vin: string | null;
    name: string;
    model: string | null;
    latest: null | {
      observedAt: number;
      state: string;
      batteryLevel: number | null;
      estimatedRangeKm: number | null;
      odometerKm: number | null;
      outsideTempC: number | null;
      chargingState: string | null;
      chargerPowerKw: number | null;
      latitude: number | null;
      longitude: number | null;
    };
  }>;
  trips: Array<{
    id: string; vehicleId: string; startTime: number; endTime: number;
    distanceKm: number; energyKwh: number | null;
    energySource: 'measured' | 'estimated' | 'legacy-estimate' | 'unknown';
    startBattery: number | null; endBattery: number | null;
    route: Array<{ lat: number; lng: number; timestamp: number }>;
    tag: 'personal' | 'business' | 'unclassified'; notes: string; incomplete: boolean;
  }>;
  charges: Array<{
    id: string; vehicleId: string; startTime: number; endTime: number;
    energyKwh: number | null; startBattery: number | null; endBattery: number | null;
    maxPowerKw: number | null; locationName: string | null;
    locationType: 'home' | 'work' | 'public' | 'unknown';
    cost: number | null; costSource: 'actual' | 'estimated' | 'unknown';
    ratePerKwh: number | null; // raw session override; null inherits home tariff
    incomplete: boolean; // older v2 clients may default absent to false
  }>;
  battery: Array<{
    id: string; vehicleId: string; timestamp: number;
    odometerKm: number | null; batteryLevel: number | null; fullRangeKm: number | null;
  }>;
  idles: Array<{
    id: string; vehicleId: string; startTime: number; endTime: number;
    energyKwh: number | null; state: 'asleep' | 'parked' | 'unknown'; incomplete: boolean;
  }>;
  collector: {
    mode: 'paused' | 'polling' | 'telemetry';
    status: 'paused' | 'waiting_for_auth' | 'collecting' | 'error' | 'budget_paused';
    lastReceivedAt: number | null;
    message: string;
    usage: { month: string; estimatedCostUsd: number; limitUsd: number; requests: number; signals: number };
  };
}
```

## Owner metadata

All endpoints below require the same server access token. None operate the car.

- `PATCH /api/v2/settings`: partial `currency`, `timeZone`, `homeRatePerKwh`, `batteryCapacityKwh`; returns the full updated snapshot. Null clears optional numbers. Tariffs are not guessed.
- `PATCH /api/v2/trips/:id`: partial `{tag, notes}`; returns updated snapshot.
- `PATCH /api/v2/charges/:id`: partial `{locationName, locationType, cost, ratePerKwh}`; returns updated snapshot. Actual cost overrides tariff estimates.
- `GET /api/v2/export`: versioned JSON backup (no credentials), attachment. Adds `legacyArchives` containing preserved known legacy data keys. Server CLI and Windows daily backups use this endpoint/format; offline client exports contain the normalized synced snapshot only.
- `POST /api/v2/import`: `{ format: 'legacy', data: <old export object> }` or `{format:'snapshot', data:<Snapshot>}`; validate and merge idempotently, returning a snapshot. Never replace credentials or collector configuration from an import.

Clients should disable remote edits when disconnected and preserve unsaved form input. No vehicle command/wake routes exist. Budget figures are estimates for this collector, not the Tesla billing ledger; they do not guarantee a $0 bill for an account used by other applications. Collector starts paused until explicitly configured on the server. Polling reserves costs before network calls; stopping a telemetry consumer does not stop a vehicle's billable stream. Telemetry is additionally gated by `QUAGOEV_TELEMETRY_SOURCE_BUDGET_VERIFIED=true` after deployment validation.

Imports restore valid owner preferences only into an installation with no existing records. They never replace server credentials, server identity, collector settings or existing owner record edits.

`GET /auth/status` and `GET /auth/login` use the same Bearer credential. Status returns `{authenticated, configured, collectorMode}`; login returns a Tesla OAuth URL with data/location permissions. The server handles the browser redirect at `/auth/callback` (or `/callback` for an existing registration). This is independent of client access to saved data.

## Deployment validation still required

Tesla account allowance and usage, target Windows OS/service startup, Tailscale reachability, telemetry certificate and mutual-TLS handshake, virtual-key permissions and actual vehicle data must be verified on the deployment host. A local/demo test does not establish any of these.
