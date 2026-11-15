# Windows home server and desktop deployment

QuagoEV uses the spare Windows laptop as the personal data server. Desktop and native iOS clients synchronize its saved data over private HTTPS. Their reads never contact Tesla. Fresh installations begin with collection paused; updates preserve existing collector configuration. No installation step sends a vehicle command or changes Tesla billing settings.

## What is included

- `electron/`: macOS/Windows desktop shell with bundled UI, isolated renderer and OS-encrypted server access key. It connects to the home server; it does not run a second collector.
- `scripts/windows/Install-QuagoEV.ps1`: installs the server into `%ProgramData%\QuagoEV` and creates a startup task running as **Local Service**, with no Windows password stored by QuagoEV.
- `Run-QuagoEV.ps1`: starts Node with protected configuration and loopback binding; logs are local.
- `Get-QuagoEVStatus.ps1`: checks the startup task and local health endpoint without displaying secrets.
- `Backup-QuagoEV.ps1`: exports a complete credential-free JSON history backup.
- `Uninstall-QuagoEV.ps1`: removes the startup task and preserves files/history.

## Build the release bundle on the development computer

```sh
npm ci
npm run build
npm run server:package
```

The bundle is `release/server/QuagoEV-Server-<version>.zip`. It includes source, a built UI, install scripts, dependency lockfile and a SHA-256 inventory. It deliberately excludes `.env`, `.sessions.json`, private keys, databases and existing personal data. Node dependencies are installed on the Windows host to avoid copying incompatible native binaries.

## Install on the Windows laptop

1. Install a supported Windows release and system-wide **Node.js 24 or later** from [nodejs.org](https://nodejs.org/). The default Node path used by the installer is `C:\Program Files\nodejs\node.exe`.
2. Extract the release ZIP into a local folder. Keep its contents together.
3. Open **PowerShell as Administrator**, change into the extracted folder and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Install-QuagoEV.ps1
```

The execution-policy override applies to this process only. The installer installs locked production dependencies, initializes `%ProgramData%\QuagoEV\data\server.env`, restricts filesystem permissions and registers `QuagoEV Server` to start 30 seconds after Windows boots. A second task exports history daily at 03:00 local Windows time and retains the latest 30 backup files. Updates preserve the data directory and existing configuration. It does not create router rules or change Windows sleep settings.

4. Check local startup:

```powershell
& "$env:ProgramData\QuagoEV\app\scripts\windows\Get-QuagoEVStatus.ps1"
```

5. In Windows power settings, set **sleep while plugged in** to Never. Turning the display off is fine. If the lid will be closed, explicitly set its plugged-in action to **Do nothing**. Keep the laptop ventilated. Test a restart with nobody logged in; collection cannot run while the computer is asleep or shut down.

The server binds to `127.0.0.1:3001`. Use the local browser at `http://127.0.0.1:3001` for setup. Obtain `QUAGOEV_ACCESS_TOKEN` from `server.env` in an administrator-only editor and enter it into your clients. This is a QuagoEV server key, not a Tesla token. Do not paste the complete environment file into chat or logs.

The service's account can read application files and modify its protected data directory. Administrator access is required to read or edit the installed configuration. Existing Tesla credentials are not silently copied into a shared release.

## Connect your own devices privately

Install [Tailscale](https://tailscale.com/download) on the Windows server, Mac/Windows client computers and iPhone, and sign them into your personal tailnet. Tailscale Personal is currently free for personal use; confirm [current plan limits](https://tailscale.com/pricing) during deployment.

On the server, enable [unattended operation](https://tailscale.com/docs/how-to/run-unattended). Use [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) to publish the loopback API **privately** inside your tailnet:

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:3001
tailscale serve status
```

Follow Tailscale's account prompts for HTTPS/MagicDNS if needed. Enter the resulting `https://<machine>.<tailnet>.ts.net` base URL in QuagoEV, together with the server access key. No `/api` suffix is needed. The access key remains required even inside the tailnet.

Verify `/healthz` from the iPhone over mobile data and another desktop outside the home Wi-Fi, then synchronize actual history. New data requires the server and home internet to be running; saved history remains accessible on clients when either is unavailable. Tailscale must remain connected on the iPhone for remote sync.

**Do not use Funnel for the QuagoEV UI/API.** Funnel publishes a service to the public internet. The private Serve port and any public telemetry port must remain separate.

## Move existing history

Privately copy the current Mac's `data-v2/migration-backup-v2.json` to the Windows laptop. The shared server ZIP contains no personal history or credentials. Connect QuagoEV to the new server and use **Settings → Import JSON** to import this backup. Keep the original Mac data and backup until trip/charging counts, totals and sampled records agree on the Windows server and its clients.

Alternatively, import from an administrator PowerShell session. This example assumes the privately transferred file is in your Downloads folder; adjust `$historyFile` to its actual location. Stop the server for a command-line import and restart it afterwards:

```powershell
$historyFile = Join-Path $env:USERPROFILE 'Downloads\migration-backup-v2.json'
Stop-ScheduledTask -TaskName 'QuagoEV Server'
try {
    & "$env:ProgramFiles\nodejs\node.exe" `
      "$env:ProgramData\QuagoEV\app\scripts\server-setup.mjs" import `
      --data-dir "$env:ProgramData\QuagoEV\data" --file $historyFile
    if ($LASTEXITCODE -ne 0) { throw 'History import failed; keep the original backup and inspect the error.' }
} finally {
    Start-ScheduledTask -TaskName 'QuagoEV Server'
}
```

In an administrator-only editor, put the existing Tesla application's `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET` and appropriate `TESLA_FLEET_API` into the new protected `data\server.env`. Set `TESLA_REDIRECT_URI` to the exact registered callback on the new private server, normally `https://<machine>.<tailnet>.ts.net/auth/callback`; the existing `/callback` alias is also supported when that is the registered path. Update the existing Tesla application's callback registration to match exactly. The browser completing Tesla login must have Tailscale access to that address.

Restart `QuagoEV Server` after editing its configuration, then open **Settings → Tesla data connection**, choose **Prepare connection**, and **Continue to Tesla**. History import does not transfer Tesla authorization. Preserve the new server's generated access/vault keys, keep collection paused during this move, and do not put the live environment file into a release ZIP.

## Tesla collection and the $0 API target

Keep the existing Tesla developer application. The installed collector remains paused until its Tesla authorization, budget settings and a permitted data path have been validated. See the implementation's server setup instructions for current supported modes. The app does not require vehicle controls; OAuth should request only data and optional location permissions.

The monthly allowance is a Tesla account billing property, not a separate free API. Before enabling collection, check that account's actual allowance, other usage and spending cap in the [Tesla developer portal](https://developer.tesla.com/docs/fleet-api/billing-and-limits). Local cost accounting is conservative guidance, not an authoritative invoice. Never increase a spending limit automatically. If the budget is exhausted, collection must pause and clients continue showing saved data.

For telemetry, a local pause only stops ingestion. It does **not** stop the car transmitting or Tesla charging for signals. The source-side shutdown and account spending limit must be tested before setting `QUAGOEV_TELEMETRY_SOURCE_BUDGET_VERIFIED=true`. This verification flag does not itself enforce a Tesla cap. See [TELEMETRY.md](TELEMETRY.md) for the bridge, supported data fields and remaining receiver deployment checks.

Tesla's efficient Fleet Telemetry receiver needs public reachability and end-to-end mutual TLS. A private Tailscale IP cannot be reached directly by the vehicle. [Tesla's receiver documentation](https://github.com/teslamotors/fleet-telemetry) requires mutual TLS to terminate at the receiver.

A free **candidate to test** is Tailscale Funnel **raw TCP** on port 8443 to a local receiver, with a valid certificate matching the Funnel hostname. Keep private app access on port 443. Ordinary HTTPS proxying or `--tls-terminated-tcp` is not a substitute because it terminates TLS before Tesla's receiver authenticates the vehicle. [Funnel TCP documentation](https://tailscale.com/docs/reference/tailscale-cli/funnel)

This candidate is **not a verified deployment**. Funnel has hostname/port/bandwidth constraints and remains a third-party service. Before changing telemetry configuration, validate the public certificate chain, Tesla mutual-TLS handshake, signed setup using data permissions, actual incoming records, certificate renewal, and reboot recovery. A Linux receiver/container on Windows needs its own unattended-start validation. No script here enables Funnel, changes the car configuration or opens a public firewall port.

## Backups and restoring history

Daily local backups are installed automatically. To make an additional backup, run in an administrator PowerShell session while the server is running:

```powershell
& "$env:ProgramData\QuagoEV\app\scripts\windows\Backup-QuagoEV.ps1"
```

Backups go to `data\backups` unless `-OutputDirectory` is supplied. Keep a second copy on another disk or an existing trusted backup location; another folder on the same laptop is not protection against disk failure. The backup contains personal trip/location data but no credentials. To restore or move history, use QuagoEV's JSON import, which merges records idempotently. Keep the old installation/data until totals and sampled records have been verified.

The history export does **not** restore Tesla authorization or encrypted token-vault keys. Preserve those through a separately protected system backup if required; otherwise reauthorize Tesla after moving hosts. Never distribute a live `server.env` or vault with app builds.

## Desktop packages

```sh
npm run desktop:mac
npm run desktop:win
```

ZIP files are written to `release/desktop/`. These are development builds without paid signing or notarization. macOS and Windows release acceptance must be tested on their target operating systems before distribution. First launch opens server connection setup; demo mode is explicitly labelled and remains separate from personal history.

Native credential persistence fails closed if OS encryption is unavailable. Cached trip history is stored in the app's local profile; enable the device's OS disk encryption if required. Disconnect/forget clears that app's credentials and history cache. The desktop app only allows network requests to its configured server origin and contains no remote renderer code.

## Target-host acceptance checklist

- Install dependencies and initialize without printing access keys or making Tesla calls.
- Startup task runs after reboot before login, restarts after a server failure, and uses the intended protected data directory.
- Local health passes and unauthorized API requests return 401.
- Private Tailscale HTTPS works from iPhone mobile data and a remote desktop.
- The app shows the same stored totals on all clients; loading/reloading a client does not increase Tesla request count.
- Offline relaunch preserves saved history; disconnect/forget removes it.
- Backup restores into a separate test data directory without duplicates.
- Only after setup approval: validate permitted Tesla collection, observed data timestamps, budget pause and recovery. A local health response or demo screen is not evidence of live Tesla connectivity.

## Stop or remove startup

```powershell
Stop-ScheduledTask -TaskName 'QuagoEV Server'
& "$env:ProgramData\QuagoEV\app\scripts\windows\Uninstall-QuagoEV.ps1"
```

The removal script leaves history/configuration intact and does not alter Tailscale. Remove the specific private Serve mapping separately when retiring the server; do not reset unrelated Tailscale services.
