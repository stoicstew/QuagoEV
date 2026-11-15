#Requires -Version 5.1
[CmdletBinding()]
param([string]$InstallDirectory = (Join-Path $env:ProgramData 'QuagoEV'))
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'QuagoEV Server' -ErrorAction SilentlyContinue
if (!$task) { Write-Host 'QuagoEV Server is not installed as a scheduled task.'; exit 1 }
$info = Get-ScheduledTaskInfo -TaskName 'QuagoEV Server'
[PSCustomObject]@{ Task = $task.TaskName; State = $task.State; LastStarted = $info.LastRunTime; LastTaskResult = $info.LastTaskResult; Configuration = (Join-Path $InstallDirectory 'data/server.env') } | Format-List
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/healthz' -TimeoutSec 5
    Write-Host "Local API: $($health.status), schema $($health.schemaVersion)"
} catch { Write-Host 'Local API not reachable. Inspect data/logs/server-error.log on this computer.'; exit 1 }
Write-Host 'Health does not prove Tesla collection or remote Tailscale access. Check collection status in QuagoEV.'
