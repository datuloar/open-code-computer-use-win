[CmdletBinding()]
param(
    [string]$ConfigDir,
    [string]$ConfigPath,
    [string]$Model,
    [string]$MigrateFrom,
    [ValidateRange(0, 30)][int]$AnnounceSeconds = 5,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Uninstall) {
    & node (Join-Path $here 'src\verify.js')
    if ($LASTEXITCODE -ne 0) { throw 'Repository verification failed; OpenCode was not changed.' }
}
$arguments = @((Join-Path $here 'src\install-opencode.js'))
if ($ConfigDir) { $arguments += @('--config-dir', $ConfigDir) }
if ($ConfigPath) { $arguments += @('--config', $ConfigPath) }
if ($Model) { $arguments += @('--model', $Model) }
if ($MigrateFrom) { $arguments += @('--migrate-from', $MigrateFrom) }
if ($PSBoundParameters.ContainsKey('AnnounceSeconds')) { $arguments += @('--announce-seconds', "$AnnounceSeconds") }
if ($Uninstall) { $arguments += '--uninstall' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'OpenCode installation failed.' }
Write-Host 'Restart OpenCode to load the updated computer-use integration.'
