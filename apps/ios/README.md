# QuagoEV for iOS

Native SwiftUI companion for the QuagoEV personal server. Requires iOS 17 or later. Uses Swift Charts, MapKit and Keychain; it does not embed the desktop web UI and has no vehicle command endpoints.

## Open and run

Open `QuagoEV.xcodeproj` in Xcode and select the **QuagoEV** scheme. Simulator builds use local ad-hoc signing and do not need a paid signing identity. Keep simulator signing enabled so Keychain has an application identifier. For an actual iPhone, select your own development team and a suitable bundle identifier in Signing & Capabilities before running on the device. No physical-device install, App Store Connect upload or TestFlight release is included in the local validation.

The project is checked in. If source files are added or removed, regenerate it with:

```sh
python3 apps/ios/scripts/generate_project.py
```

From the repository root, build a simulator app:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project apps/ios/QuagoEV.xcodeproj -scheme QuagoEV \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/ios/build CODE_SIGN_IDENTITY=- build
```

## Connect to your Windows home server

1. Run the QuagoEV server and its private HTTPS endpoint on the Windows laptop.
2. Install Tailscale on the iPhone and join the same personal network as the server.
3. In QuagoEV, choose **Connect to home server**. Enter the private HTTPS address and QuagoEV server access key. This is not a Tesla access token.
4. The app downloads `/api/v2/snapshot` and stores a local copy. Opening the app, bringing it to the foreground or pulling to refresh requests new history from the server. These requests do not poll Tesla.

The app requires HTTPS for remote addresses and rejects embedded credentials, query strings and redirects. Plain HTTP is permitted only for localhost development. The QuagoEV key is stored in this device’s Keychain. Snapshot caches are separated by server address and credential fingerprint, pinned to the returned server ID, written atomically and excluded from iCloud device backup. Forgetting a connection removes its credentials and all local QuagoEV history/cache/export files.

Cached history opens while the server is unavailable or authorization needs updating. A failed response never replaces the cache. A successful empty snapshot does replace old records. Editing requires a recently successful connection; failed edits preserve the open draft. The Windows server needs power and internet for new collection; iOS background execution is not used as the vehicle collector.

## Included screens

- Overview with last-observed readings, freshness, known-data totals and collector status.
- Drives with date and vehicle selection, weighted efficiency, detail records, classification/notes editing and CSV export.
- Charging sessions with partial-recording labels, observed energy, cost provenance, location labels, actual-cost editing and optional session tariff overrides. A blank override inherits the home rate for home sessions. Complete-drive efficiency excludes partial recordings; totals label partial coverage.
- Battery range trends with explicit estimate labels; no unsupported fleet health comparison.
- Insights showing known/unknown coverage, incomplete recordings, tagged business distance and estimated collector usage.
- Native settings with tariff/capacity preferences and a complete saved-snapshot JSON export.
- Offline route sketch from saved coordinates. Optional MapKit backgrounds require network access when not already cached.
- Explicit sample mode backed by the shared repository fixture. It never overwrites a real cache and does not make server calls.

JSON exports conform to the v2 snapshot import format. CSV exports use UTC timestamps and neutralize formula-like fields; the selected vehicle/date filters apply. Actual prices, range and energy can remain unknown. The app does not substitute sample values for missing vehicle data.

## Checks

Core contract, URL, CSV, metric and cache tests:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path apps/ios
```

For native network/offline UI acceptance, start the local fixture in one terminal:

```sh
python3 apps/ios/scripts/fixture_server.py
```

Then choose an available simulator ID from `xcrun simctl list devices available` and run:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project apps/ios/QuagoEV.xcodeproj -scheme QuagoEV \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_ID' \
  -parallel-testing-enabled NO -derivedDataPath apps/ios/build \
  CODE_SIGN_IDENTITY=- test
```

The fixture listens only on `127.0.0.1:38417`, has a fixed test-only access key, never calls Tesla, and is not part of the server deployment. The sync UI test is skipped if this fixture is not running. It connects through the real native HTTP client, switches the fixture to HTTP 503, relaunches the app and verifies that history persisted. Navigation UI tests use explicitly labelled sample data.

See `VERIFICATION.md` for the observed validation results and remaining device/network checks.
