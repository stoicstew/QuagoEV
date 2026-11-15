#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $env:ProgramData 'QuagoEV/data'),
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (!$OutputDirectory) { $OutputDirectory = Join-Path $DataDirectory 'backups' }
$configFile = Join-Path $DataDirectory 'server.env'
$line = Get-Content -LiteralPath $configFile | Where-Object { $_ -match '^QUAGOEV_ACCESS_TOKEN=' } | Select-Object -Last 1
if (!$line) { throw 'Access key was not found in server.env.' }
$token = ($line -replace '^QUAGOEV_ACCESS_TOKEN=', '').Trim().Trim('"').Trim("'")
if ($token.Length -lt 16) { throw 'Invalid server access key.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$target = Join-Path $OutputDirectory ('quagoev-history-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$temp = "$target.partial"
try {
    Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/v2/export' -Headers @{ Authorization = "Bearer $token" } -OutFile $temp -TimeoutSec 60
    # Reject a partial/invalid response before promoting it to a backup.
    $null = Get-Content -LiteralPath $temp -Raw | ConvertFrom-Json
    Move-Item -LiteralPath $temp -Destination $target
    Get-ChildItem -LiteralPath $OutputDirectory -Filter 'quagoev-history-*.json' -File |
        Where-Object { $_.Name -match '^quagoev-history-\d{8}-\d{6}\.json$' } |
        Sort-Object Name -Descending | Select-Object -Skip 30 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    Write-Host "Data backup saved: $target"
} finally {
    $token = $null
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
}
