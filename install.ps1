[CmdletBinding()]
param(
    [string]$DshHome = $env:DSH_HOME,
    [switch]$SkipSkill,
    [switch]$SkipPath
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say([string]$text) { Write-Host $text }

Say "dsh-computer-use -> installing from $here"

if (-not $SkipSkill) {
    if (-not $DshHome) {
        Say 'DSH_HOME is not set and -DshHome was not given: skipping the skill copy.'
        Say 'Copy SKILL.md to <dsh home>\skills\dsh-computer-use\SKILL.md by hand, or set DSH_HOME.'
    } else {

        $target = Join-Path $DshHome 'skills\dsh-computer-use'
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Copy-Item (Join-Path $here 'SKILL.md') (Join-Path $target 'SKILL.md') -Force
        Say "skill installed: $target\SKILL.md"
    }
}

if (-not $SkipPath) {
    $cli = Join-Path $here 'src\cli.js'
    if (-not (Test-Path $cli)) { throw "src\cli.js is missing next to install.ps1 ($here)" }
    $binDir = Join-Path $env:LOCALAPPDATA 'dsh-cu\bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Set-Content -Path (Join-Path $binDir 'dsh-cu.cmd') -Encoding ASCII -Value @('@echo off', "node `"$cli`" %*")
    Say "CLI shim: $(Join-Path $binDir 'dsh-cu.cmd')"

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $binDir) {
        [Environment]::SetEnvironmentVariable('Path', (@($userPath.TrimEnd(';'), $binDir) | Where-Object { $_ }) -join ';', 'User')
        Say "PATH updated for this user (open a new terminal to use it): $binDir"
    } else {
        Say "PATH already lists $binDir"
    }
}

Say ''
Say 'Verify the installation:'
& node (Join-Path $here 'src\verify.js')
Say '  node src\cli.js doctor'
Say '  node src\cli.js self-test     (takes over the mouse and keyboard in its own test window)'
