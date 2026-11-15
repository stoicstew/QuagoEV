# QuagoEV 2 implementation verification

Local verification on 7 November 2026. This records observed development results, not acceptance of a live Tesla connection or Windows installation.

## Delivered

- Redesigned macOS/Windows desktop app: Overview, Drives, Charging, Battery, Insights and Settings; filters, route traces, trip classification, notes, charging prices and CSV/JSON exports.
- Native SwiftUI iOS app with the same server contract, Swift Charts, optional MapKit routes, Keychain credentials and persistent saved history.
- A separate SQLite data server with encrypted Tesla tokens, data-only OAuth, no vehicle command endpoints, budget-aware polling and a tested Fleet Telemetry JSON bridge.
- Offline client startup and saved-history access. Sync uses the home server; opening a client does not call Tesla. Fresh data still requires the server and its internet connection.
- Legacy history import, raw legacy archives in server backups, idempotent restore, protected Windows startup and daily backup scripts.

## Checks performed

- Forty server/client/telemetry/Electron unit and integration tests: passed. Coverage includes migration and restore, unknown measurements, session gaps, partial charges, cost inheritance, authentication, read-only routing, conservative usage reservation, sparse telemetry and replay, cache identity, CSV escaping and desktop navigation restrictions.
- TypeScript type checking, Vite production build and `git diff --check`: passed.
- Five Playwright browser workflows: passed, including sample isolation, connection/cache behavior, offline relaunch, editing and exports, and forgetting a connection during an outstanding request. Desktop and narrow layouts were visually inspected.
- Electron runtime smoke test and packaged Apple Silicon app launch: passed. Bundled UI opens without a server, renderer has no Node access, OS-encrypted credentials persist and forgetting clears them.
- Ten Swift core tests and simulator compilation: passed. Two native UI workflows passed, including a real local fixture HTTP sync, unavailable-server response, relaunch into cached history, Keychain persistence and offline export. The later partial-charge/tariff update was checked with core tests and compilation; full UI workflows were not repeated for that localized update.
- Unsigned generic iOS Release compilation: passed. See [native verification](../apps/ios/VERIFICATION.md) for device acceptance still needed.
- Five Windows PowerShell scripts parsed with PowerShell 7.6.9 on macOS. This is syntax validation, not Windows task/ACL acceptance.
- npm dependency audit: zero reported vulnerabilities at the time of verification.

Automated tests use temporary databases, synthetic tokens and labelled sample fixtures. No test made a live Tesla request. Local existing history was separately migrated into `data-v2`; the original history/session files and a pre-rebuild source archive were retained. The migrated Tesla session is encrypted and collection is paused. A separate HTTP smoke check against the migrated database passed health/authentication checks, confirmed matching trip/charge counts and preserved original archive fields, and recorded zero Tesla requests. A current backup is saved privately at `data-v2/migration-backup-v2.json`.

## Release and deployment limits

Desktop ZIPs are unsigned development builds. The Apple Silicon app was launched locally; Intel macOS and Windows cross-builds require testing on their target machines. iOS requires an Xcode signing team and physical-device installation; no TestFlight upload or App Store submission was performed.

The Windows installer has not run on the spare laptop. Startup before login, scheduled backups, private Tailscale HTTPS from iPhone cellular, sleep/reboot recovery and actual migration totals across devices remain deployment checks. See [Windows setup](WINDOWS_SERVER.md).

The Tesla account allowance and spending protection have not been verified live. Collection stays paused. The telemetry bridge is implemented, but the external receiver, public mutual-TLS path, vehicle provisioning, certificate renewal and source-side shutdown remain to be deployed and tested. A local ingestion limit cannot stop Tesla billing. No guaranteed zero-dollar bill or complete Tessie feature parity is claimed. See [telemetry setup](TELEMETRY.md).
