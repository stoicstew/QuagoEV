# Fleet Telemetry ingestion

The repository includes a **tested JSON-to-observation bridge**, not a deployed Tesla telemetry receiver. It has not been connected to the user's vehicle, Windows host or Tailscale Funnel. Collector startup stays paused by default.

## Data path

```text
Tesla vehicle → public end-to-end mTLS → official Fleet Telemetry receiver
              → UTF-8 JSON logger file → QuagoEV telemetry bridge
              → loopback /internal/observations → SQLite → private client API
```

The official receiver authenticates the vehicle and terminates mutual TLS. The bridge never handles a Tesla OAuth token or application signing key, does not contact Tesla and cannot configure the vehicle. Its separate `QUAGOEV_TELEMETRY_TOKEN` authenticates only local observation ingestion. Do not expose `/internal/observations` through the public telemetry port.

## Supported input and source references

The adapter was checked against `teslamotors/fleet-telemetry` commit `bb7c8a931e46da3b3eb6d20a67541c8f755f1ee6`:

- [Logger envelope](https://github.com/teslamotors/fleet-telemetry/blob/bb7c8a931e46da3b3eb6d20a67541c8f755f1ee6/datastore/simple/logger.go): JSON log entries with `msg: record_payload`, `metadata.txtype: V`, `vin`, and a `data` map.
- [Logger field transformation](https://github.com/teslamotors/fleet-telemetry/blob/bb7c8a931e46da3b3eb6d20a67541c8f755f1ee6/datastore/simple/transformers/payload.go): plain or verbose typed values plus `Vin`, `CreatedAt` and `IsResend`.
- [Connectivity transformation](https://github.com/teslamotors/fleet-telemetry/blob/bb7c8a931e46da3b3eb6d20a67541c8f755f1ee6/datastore/simple/transformers/vehicle_connectivity.go): `CONNECTED`/`DISCONNECTED` and epoch-second timestamps.
- [Protobuf schema](https://github.com/teslamotors/fleet-telemetry/blob/bb7c8a931e46da3b3eb6d20a67541c8f755f1ee6/protos/vehicle_data.proto): decoded payloads with `data: [{key,value}]`, `vin` and `createdAt` are also accepted, using camelCase or snake_case scalar fields.

Select JSON logging, the logger dispatcher for `V`/`connectivity`, and preferably verbose values in the official receiver. These are configuration fragments to merge into a separately validated receiver configuration, not a complete receiver installation:

```json
{
  "json_log_enable": true,
  "logger": { "verbose": true },
  "records": { "V": ["logger"], "connectivity": ["logger"] }
}
```

The bridge maps state of charge, odometer, estimated range, location, outside temperature, vehicle name/model, gear/speed, charging state/power and supported energy counters. Odometer/range values are converted to kilometres. Unknown and invalid measurements are omitted; they are never converted to zeros. Sparse updates retain existing values on the server. Disconnection is not proof of sleep. `DCChargingEnergyIn` is the battery-side session counter for both AC and DC; `ACChargingEnergyIn` is intentionally not substituted because it measures charger input. [Tesla field definitions](https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data)

Logger signals outside that subset still count towards the local usage estimate. Input logs are sensitive: they can contain VINs and locations. Protect them like the history database. The bridge's own status output contains counts and errors, not payloads or access tokens.

## Run after receiver and budget verification

Load the existing protected configuration, then point the bridge at an append-only **UTF-8** JSON-lines file. The checkpoint should be in the protected data directory. Example Windows PowerShell:

```powershell
$env:DOTENV_CONFIG_PATH = "$env:ProgramData\QuagoEV\data\server.env"
node "$env:ProgramData\QuagoEV\app\scripts\telemetry-bridge.mjs" `
  --file "$env:ProgramData\QuagoEV\data\telemetry\receiver.jsonl" `
  --checkpoint "$env:ProgramData\QuagoEV\data\telemetry\bridge-checkpoint.json"
```

`--once` processes complete records currently available and exits. The normal mode follows appended lines, retrying temporary local API failures. `QUAGOEV_INGEST_URL` can override the default loopback URL, but only a loopback HTTP `/internal/observations` URL is accepted. Remote forwarding is deliberately rejected.

Do not use Windows PowerShell 5's default `>` text redirection to create the input: it can write UTF-16. Have the receiver/container write UTF-8 bytes, or capture stdout through a byte-preserving mechanism. Incomplete final lines wait for a newline; malformed JSON, rejected records and permission failures preserve the previous checkpoint.

The bridge advances its checkpoint only after a successful local API response. A crash after ingestion but before checkpointing replays the same deterministic observation ID. The server deduplicates it. Separate same-time records are processed; resend metadata is excluded from the identity hash. The logger rounds its `CreatedAt` display to seconds, so this path is not a source of subsecond timing precision.

The input log must not be truncated or rotated underneath the bridge. Replacement, changed prefix or truncation stops it rather than skipping unprocessed data. Before rotation, drain the old file. To recover from an unexpected rotation, replay the archived old file with a fresh checkpoint (deduplication prevents duplicate observations), then start the new file with another checkpoint. Keep the archived log until totals have been checked. A lock prevents simultaneous bridge processes using the same checkpoint.

The logger dispatcher does not offer durable end-to-end acknowledgements tied to QuagoEV storage. The checkpoint protects replay of records already written to disk, but a receiver or disk failure can still lose data. A durable broker dispatcher is needed for stronger delivery guarantees. [Official dispatcher and acknowledgement documentation](https://github.com/teslamotors/fleet-telemetry#reliable-acks)

## Budget control is a source-side requirement

**Rejecting an observation or stopping the bridge does not stop the vehicle streaming and does not stop Tesla billing.** The local estimate is not an authoritative Tesla ledger. It omits usage by other apps and may not cover signals lost before they reach the bridge.

Before enabling telemetry:

1. Check the Tesla account's actual monthly discount, current usage and spending limit. Preserve the intended $0 out-of-pocket boundary; do not assume a numeric local limit configures Tesla billing.
2. Configure only the fields and transmission intervals needed for the app. Start conservatively and compare actual portal usage against local estimates.
3. Establish and test a **source-side shutdown**: removal of the vehicle's telemetry configuration through the supported Tesla setup path, plus the Tesla-side billing limit as a backstop. QuagoEV's data-only client API does not expose this configuration operation, and this bridge does not automate it.
4. Keep enough budget headroom for delayed readings, other API requests and shutdown. Only mark billing/source-budget prerequisites verified once this procedure has been tested on the real account.
5. If the local API pauses ingestion, check the source immediately. Do not leave the vehicle streaming into a stopped bridge.

After these checks, the protected `server.env` must set `QUAGOEV_COLLECTOR_MODE=telemetry`, `QUAGOEV_BILLING_VERIFIED=true` and `QUAGOEV_TELEMETRY_SOURCE_BUDGET_VERIFIED=true`, followed by a server restart. Both verification flags default to `false`. The source-budget flag records an operator's completed verification; it does **not** configure a Tesla spending cap or automatically remove a vehicle's telemetry configuration. Missing verification keeps ingestion paused. A local budget rejection stops the bridge with its checkpoint pending and still requires source-side action.

Tesla can remove telemetry configurations when its billing limit is exceeded; restoration is a separate setup action. [Tesla billing and limits](https://developer.tesla.com/docs/fleet-api/billing-and-limits)

## Required deployment checks

- Confirm vehicle/firmware eligibility, data-only consent and virtual-key setup with the existing Tesla application.
- Validate the public certificate chain and end-to-end mTLS with the official receiver. A generic HTTPS proxy or TLS-terminating tunnel is insufficient.
- Validate the proposed free raw-TCP Funnel path on the actual home connection. Private app access and public telemetry ingress use different ports; never publish the QuagoEV API.
- Prove the receiver, bridge, certificate renewal and server recover after a Windows reboot without login. The current Windows installer schedules the QuagoEV API and backup only; it does not install or schedule the external receiver/bridge.
- Receive a real drive and charge, compare timestamps/units with the vehicle, and check reconnect, malformed input, retry, deduplication and budget-stop behavior.

Only the parser/replay behavior is verified locally. These deployment checks remain outstanding until performed on the spare laptop and vehicle.
