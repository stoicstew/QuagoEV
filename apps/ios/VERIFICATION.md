# Native iOS verification — 7 November 2026

## Observed local results

- Xcode 27.0 (27A266a), iOS 27 SDK; deployment minimum iOS 17.
- Debug simulator build and build-for-testing passed.
- Unsigned Release build for generic iOS device passed. This validates compilation only; it is not a device-installable signed release.
- Ten Swift core tests passed: shared v2 fixture decoding/millisecond timestamps/null data; invalid versions and duplicate IDs; distance-weighted efficiency; formula-safe quoted CSV; HTTPS URL restrictions; persisted profile-separated cache; successful empty snapshot replacing old history; changed server identity rejection; backward-compatible partial-charge flags/null tariff inheritance; and exclusion of partial drives from complete-drive efficiency.
- Two XCTest UI workflows passed on iPhone 17 Pro / iOS 26.5: native tab/detail/settings navigation; and local fixture connection, real HTTP snapshot sync, Keychain/cache persistence, server HTTP 503, app relaunch into saved history, offline export availability and forgetting the connection.
- The fixture test uses a test-only local HTTP server and sample data. It makes no Tesla API requests. HTTP 503 verifies unavailable-server handling; physical loss of Wi-Fi/cellular has not been tested on an iPhone.
- Inspected the iPhone overview in light and dark appearance for layout and readable contrast. `verification/overview-iphone.png` and `verification/overview-iphone-dark.png` contain explicitly labelled sample data.
- After adding partial-charge indicators and nullable session-tariff editing, reran the ten core tests and simulator compilation successfully. Full UI workflows were not repeated for this localized update.

Simulator runtime tests use local ad-hoc signing (`CODE_SIGN_IDENTITY=-`). Disabling signing entirely prevents the simulator app from receiving a Keychain application identity, so `CODE_SIGNING_ALLOWED=NO` is suitable for compile-only checks, not credential acceptance.

## Remaining acceptance on the deployment devices

- Connect a physical iPhone to the real Windows server via private Tailscale HTTPS, both on home Wi-Fi and cellular.
- Verify real server certificate validation, actual access key rotation, Windows reboot recovery and background collector uptime.
- Confirm Tesla telemetry provisioning, observations, history totals and the account’s billing allowance separately on the server.
- Test airplane-mode cold launch, reconnection, large history performance, Dynamic Type/VoiceOver and MapKit map availability on physical devices.
- Choose signing team/bundle identifier and complete physical-device signing and distribution. No TestFlight upload, App Store submission or signed installation was performed.

No runtime collection claim is inferred from these local app tests. The iOS client reads the server database; it does not continuously collect data from Tesla in the background.
