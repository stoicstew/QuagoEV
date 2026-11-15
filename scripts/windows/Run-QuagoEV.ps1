#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$AppDirectory,
    [Parameter(Mandatory=$true)][string]$DataDirectory,
    [Parameter(Mandatory=$true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:QUAGOEV_DATA_DIR = [IO.Path]::GetFullPath($DataDirectory)
$env:DOTENV_CONFIG_PATH = Join-Path $env:QUAGOEV_DATA_DIR 'server.env'
$env:QUAGOEV_BIND_HOST = '127.0.0.1'
$env:PORT = '3001'
$env:NODE_ENV = 'production'
if (!(Test-Path -LiteralPath $env:DOTENV_CONFIG_PATH -PathType Leaf)) { throw 'Missing protected server.env configuration.' }
$logDirectory = Join-Path $env:QUAGOEV_DATA_DIR 'logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
foreach ($name in @('server.log', 'server-error.log')) {
    $file = Join-Path $logDirectory $name
    if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 10MB) { Move-Item -LiteralPath $file -Destination "$file.previous" -Force }
}
$entry = Join-Path ([IO.Path]::GetFullPath($AppDirectory)) 'server/index.js'
$process = $null
try {
    $process = Start-Process -FilePath $NodePath -ArgumentList @('"' + $entry + '"') -WorkingDirectory $AppDirectory -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
    $process.WaitForExit()
    # An unexpected clean exit should also trigger the scheduled task's restart policy.
    if ($process.ExitCode -eq 0) { exit 1 }
    exit $process.ExitCode
} finally {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
