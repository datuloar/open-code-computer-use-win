param(
    [string]$Output,
    [double]$Scale = 1,
    [int]$Width = 1000,
    [string]$Theme = 'opencode'
)

$ErrorActionPreference = 'Stop'
$env:DSH_CU_THEME = $Theme
$env:DSH_CU_UI_SCALE = $Scale.ToString([Globalization.CultureInfo]::InvariantCulture)
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'backends\windows.ps1') display | Out-Null
$canvasWidth = [DshCu.Theme]::Px($Width)
$rowHeight = [DshCu.PanelRenderer]::CanvasHeight()
$renderer = New-Object DshCu.PanelRenderer($canvasWidth)
$window = New-Object DshCu.LayeredWindow((New-Object Drawing.Rectangle(0, 0, $canvasWidth, $rowHeight)))
$canvas = [DshCu.Theme]::Canvas($canvasWidth, ($rowHeight * 3))
$graphics = [Drawing.Graphics]::FromImage($canvas)
try {
    $graphics.Clear([Drawing.Color]::FromArgb(38, 38, 38))
    $field = $renderer.GetType().GetField('_canvas', [Reflection.BindingFlags]'Instance,NonPublic')
    for ($row = 0; $row -lt 3; $row++) {
        $state = New-Object DshCu.PanelState
        $state.Announcing = $row -eq 0
        $state.SecondsLeft = 8
        $state.Remaining = 0.75
        $state.Pulse = 0.5
        $state.ActionOpacity = if ($row -eq 2) { 1 } else { 0 }
        $state.Action = if ($row -eq 2) { 'click Save a very long control name that must fit beside the Escape hint' } else { '' }
        $renderer.Draw($window, $state)
        $graphics.DrawImageUnscaled($field.GetValue($renderer), 0, $row * $rowHeight)
    }
    $canvas.Save([IO.Path]::GetFullPath($Output), [Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $window.Dispose()
    $renderer.Dispose()
}
Write-Output ([IO.Path]::GetFullPath($Output))
