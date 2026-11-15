#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:ProgramData 'QuagoEV'),
    [string]$SourceDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [string]$NodePath = (Join-Path $env:ProgramFiles 'nodejs/node.exe')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Protect-Directory([string]$Directory, [string]$ServiceRights) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    $serviceRule = New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-19')), $ServiceRights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($serviceRule)
    Set-Acl -LiteralPath $Directory -AclObject $acl
}

if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Install Node.js 24 or later system-wide from nodejs.org first, or specify -NodePath.' }
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'QuagoEV requires Node.js 24 or later.' }
$npmPath = Join-Path (Split-Path -Parent $NodePath) 'npm.cmd'
if (!(Test-Path -LiteralPath $npmPath -PathType Leaf)) { throw 'npm.cmd was not found beside Node.js.' }
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$install = [IO.Path]::GetFullPath($InstallDirectory)
$appDirectory = Join-Path $install 'app'
$dataDirectory = Join-Path $install 'data'
if ($source.TrimEnd('\') -eq $appDirectory.TrimEnd('\')) { throw 'Run installation from an extracted release folder, not the installed app directory.' }
foreach ($required in @('server/index.js', 'scripts/server-setup.mjs', 'package.json', 'package-lock.json', 'dist/index.html')) {
    if (!(Test-Path -LiteralPath (Join-Path $source $required) -PathType Leaf)) { throw "Incomplete server bundle: missing $required. Build the UI and run npm run server:package first." }
}
$existing = Get-ScheduledTask -TaskName 'QuagoEV Server' -ErrorAction SilentlyContinue
if ($existing) {
    Stop-ScheduledTask -TaskName 'QuagoEV Server'
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (!(Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
}
if (Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue) { throw 'Port 3001 is still in use. Stop the existing server before installing; no unrelated process was terminated.' }
New-Item -ItemType Directory -Force -Path $install, $appDirectory, $dataDirectory | Out-Null
Protect-Directory $install 'ReadAndExecute'
Protect-Directory $appDirectory 'ReadAndExecute'
Protect-Directory $dataDirectory 'Modify'
# An explicit allowlist excludes .env, OAuth sessions, keys, user data and developer tools.
foreach ($folder in @('server', 'scripts', 'dist', 'docs', 'fixtures')) {
    $from = Join-Path $source $folder
    if (Test-Path -LiteralPath $from -PathType Container) {
        $destination = Join-Path $appDirectory $folder
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        Copy-Item -LiteralPath $from -Destination $destination -Recurse -Force
    }
}
foreach ($file in @('package.json', 'package-lock.json')) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $appDirectory $file) -Force }
Push-Location $appDirectory
try {
    & $npmPath ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $NodePath (Join-Path $appDirectory 'scripts/server-setup.mjs') init --data-dir $dataDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Server initialization failed.' }
} finally { Pop-Location }
# Reapply inheritance to newly copied files, keeping the app read-only to the service.
Protect-Directory $appDirectory 'ReadAndExecute'
Protect-Directory $dataDirectory 'Modify'
$configPath = Join-Path $dataDirectory 'server.env'
if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Initialization did not create data/server.env.' }
$runner = Join-Path $appDirectory 'scripts/windows/Run-QuagoEV.ps1'
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -AppDirectory "{1}" -DataDirectory "{2}" -NodePath "{3}"' -f $runner, $appDirectory, $dataDirectory, $NodePath
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments -WorkingDirectory $appDirectory
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'QuagoEV Server' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'QuagoEV personal data server. Local Service, loopback only; Tailscale supplies private remote HTTPS.' -Force | Out-Null
$backupScript = Join-Path $appDirectory 'scripts/windows/Backup-QuagoEV.ps1'
$backupArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -DataDirectory "{1}"' -f $backupScript, $dataDirectory
$backupAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $backupArguments -WorkingDirectory $appDirectory
$backupTrigger = New-ScheduledTaskTrigger -Daily -At '03:00'
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'QuagoEV Backup' -Action $backupAction -Trigger $backupTrigger -Principal $principal -Settings $backupSettings -Description 'Daily credential-free QuagoEV history export at 03:00 local Windows time; keeps the latest 30 backups.' -Force | Out-Null
Start-ScheduledTask -TaskName 'QuagoEV Server'
Write-Host "QuagoEV installed at $appDirectory"
Write-Host "Private configuration and database: $dataDirectory"
Write-Host 'Fresh installations start with collection paused. Existing collector configuration is preserved during updates.'
Write-Host 'Next: run Get-QuagoEVStatus.ps1, then configure private Tailscale Serve as documented.'
Write-Host 'A daily history backup is scheduled for 03:00 local Windows time (latest 30 copies).'
