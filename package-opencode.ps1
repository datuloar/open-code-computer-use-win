[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$Repository
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location -LiteralPath $here
try {
    & node src/verify.js
    if ($LASTEXITCODE -ne 0) { throw 'Source contract verification failed.' }
    & node test/run.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Source unit tests failed.' }
    $arguments = @('src/package-opencode.js')
    if ($OutputDir) { $arguments += @('--output-dir', $OutputDir) }
    if ($Repository) { $arguments += @('--repository', $Repository) }
    $result = & node @arguments
    if ($LASTEXITCODE -ne 0) { throw 'OpenCode package export failed.' }
    $package = ($result -join "`n") | ConvertFrom-Json
    & node (Join-Path $package.directory 'src\verify.js')
    if ($LASTEXITCODE -ne 0) { throw 'Exported contract verification failed.' }
    & node (Join-Path $package.directory 'test\run.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Exported unit tests failed.' }
    & node (Join-Path $package.directory 'src\package-opencode.js') --check $package.directory
    if ($LASTEXITCODE -ne 0) { throw 'Exported package integrity verification failed.' }
    $archive = Join-Path (Split-Path -Parent $package.directory) ('opencode-computer-use-' + $package.version + '.zip')
    Compress-Archive -LiteralPath $package.directory -DestinationPath $archive -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksums = Join-Path (Split-Path -Parent $archive) 'SHA256SUMS.txt'
    [IO.File]::WriteAllText($checksums, ($hash + '  ' + (Split-Path -Leaf $archive) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    [pscustomobject]@{ directory = $package.directory; archive = $archive; checksums = $checksums; sha256 = $hash; version = $package.version } | ConvertTo-Json
} finally {
    Pop-Location
}
