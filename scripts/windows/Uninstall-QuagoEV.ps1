#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess=$true)]
param()
$ErrorActionPreference = 'Stop'
if ($PSCmdlet.ShouldProcess('QuagoEV Server and Backup scheduled tasks', 'Stop and unregister; preserve program, configuration and data')) {
    foreach ($name in @('QuagoEV Server', 'QuagoEV Backup')) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
    }
    Write-Host 'Startup task removed. Your files, credentials and history remain in ProgramData/QuagoEV.'
    Write-Host 'Tailscale settings were not changed. Remove its QuagoEV Serve mapping separately if no longer needed.'
}
