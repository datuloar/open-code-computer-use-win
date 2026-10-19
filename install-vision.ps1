[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'opencode-cu\vision'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$files = @(
    @{ Name = 'runtime.zip'; Url = 'https://github.com/ggml-org/llama.cpp/releases/download/b11076/llama-b11076-bin-win-vulkan-x64.zip'; Hash = '7d88a85aeb2eb6d196fe3ccee6b8ef138dbc0b88b90c185a42180e88c90eea41' },
    @{ Name = 'model.gguf'; Url = 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/Qwen3VL-4B-Instruct-Q4_K_M.gguf'; Hash = '66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a' },
    @{ Name = 'mmproj.gguf'; Url = 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/mmproj-Qwen3VL-4B-Instruct-F16.gguf'; Hash = '256f3a43bd4205ffef48d6b92715e1e70b5b0e9aef06522584967513a9985331' }
)
foreach ($file in $files) {
    $path = Join-Path $folder $file.Name
    if ((Test-Path -LiteralPath $path) -and (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $file.Hash) { continue }
    Write-Host ('Downloading ' + $file.Name)
    & curl.exe -L --fail --retry 3 -o $path $file.Url
    if ($LASTEXITCODE -ne 0) { throw ('Download failed: ' + $file.Name) }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.Hash) { throw ('Checksum mismatch: ' + $file.Name) }
}
Expand-Archive -LiteralPath (Join-Path $folder 'runtime.zip') -DestinationPath (Join-Path $folder 'runtime') -Force
Write-Host 'Local vision installed. It starts automatically on the first opencode-cu see or MCP see call.'
