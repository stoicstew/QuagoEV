# QuagoEV 2

A personal, data-only Tesla companion for macOS, Windows and native iOS. The spare Windows laptop owns collection and the database. Clients read saved data and keep an offline copy. Vehicle controls and wake commands are not part of this application.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
npm run server:init
npm run dev
```

Open `http://localhost:4200`. Choose **Explore sample data**, or connect to `http://localhost:3001` using the `QUAGOEV_ACCESS_TOKEN` in the private `data-v2/server.env` file. Initial collection is paused and no Tesla calls are made by viewing history. `npm start` serves the built UI and data API together after `npm run build`.

Do not paste a Tesla access token into the client. The client key belongs to your QuagoEV server. Desktop credentials use OS encryption; iOS uses Keychain. Browser credentials last only for that browser session. Tesla OAuth tokens stay in the encrypted server vault.

## Platforms

- **Desktop:** `npm run desktop:dev` after `npm run build`; packaged app uses its bundled UI and IndexedDB history, with a protected credential bridge.
- **Windows server:** [deployment guide](docs/WINDOWS_SERVER.md), including scheduled startup before login, private Tailscale HTTPS and daily backups.
- **iOS:** [native app and Xcode instructions](apps/ios/README.md).
- **Telemetry:** [receiver and bridge setup](docs/TELEMETRY.md). Public vehicle ingress and private client access are separate connections.

## Data and cost behavior

- Trips, charges, range trends, idle records, ownership reports and portable exports.
- AUD, kilometres, Celsius and Australia/Melbourne defaults; historical timestamps normalized to UTC milliseconds.
- Missing energy stays unknown unless measured or calculated using an owner-supplied capacity. Imported legacy energy is labelled as an estimate. Home/public charging is never guessed from charger power.
- Full snapshot synchronization, per-server local caches, explicit stale/authentication states, and isolated sample mode. Browsing an app does not make Tesla requests.
- The polling collector reserves estimated request cost before calling Tesla and stops at its local monthly budget. It never sends wake commands. Its default 10-minute interval can miss short trips and route details.
- The default local budget is US$8 gross estimated usage, leaving headroom below Tesla's currently documented US$10 developer discount. The account's actual billing settings and other applications still matter. Collection requires explicit `QUAGOEV_BILLING_VERIFIED=true` and a collector mode in the server configuration.
- Telemetry needs an externally reachable mutual-TLS receiver. A consumer-side cutoff cannot stop billable signals at the vehicle. It remains gated until source-side budget protection is validated. No zero-dollar bill or live vehicle connection is claimed by the local tests.

## Preserve and migrate old data

The v1 JSON files are not overwritten. Import `data/vehicle-history.json` and an old browser export independently; stable IDs prevent duplicates:

```sh
node scripts/server-setup.mjs import --data-dir data-v2 --file data/vehicle-history.json
node scripts/server-setup.mjs import --data-dir data-v2 --file old-browser-export.json
node scripts/server-setup.mjs backup --data-dir data-v2 --file quagoev-backup.json
```

The server cannot infer which vehicle owned unscoped legacy records. These appear under **Imported history (vehicle unassigned)**. Original import payloads are retained in SQLite. Valid owner preferences restore into an empty installation; existing preferences and edits are preserved. Server JSON backups include a legacy archive of the known original data fields; offline client exports contain the normalized synced history only. Both omit credentials. Keep an additional copy on a separate device.

An existing single-account Tesla session can be encrypted into the new vault with `import-tesla-session --file .sessions.json`. This makes no network calls. Copy the existing developer application configuration into the private server configuration and set a registered OAuth callback that reaches the new home server. Do not create a new Tesla application unnecessarily.

## Verification and builds

```sh
npm test
npm run typecheck
npm run test:browser
npm run build
node --test electron/runtime.test.cjs
npm run desktop:mac
npm run desktop:win
npm run server:package
```

Server tests use temporary databases and synthetic tokens, not Tesla. Browser and native UI tests use labelled sample fixtures. See [implementation verification](docs/VERIFICATION.md) for actual results and deployment acceptance still needed.

macOS ZIP builds are local unsigned development distributions. Windows ZIP builds are portable and unsigned. iOS device signing and distribution require selecting your own Xcode signing team; a simulator/unsigned build is not an installed iPhone release.
