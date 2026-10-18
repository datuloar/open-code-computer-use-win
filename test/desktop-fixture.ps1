param([string]$Folder)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace DshCuTest -Name ClipboardSequence -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'DSH Computer Use Test ' + (Split-Path $Folder -Leaf)
$form.Size = New-Object System.Drawing.Size(980, 620)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(22, 25, 34)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font('Segoe UI', 12)
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Computer use test workspace'
$label.Location = New-Object System.Drawing.Point(32, 28)
$label.AutoSize = $true
$form.Controls.Add($label)
$edit = New-Object System.Windows.Forms.TextBox
$edit.AccessibleName = 'Test editor'
$edit.Multiline = $true
$edit.AcceptsTab = $true
$edit.ScrollBars = 'Both'
$edit.Location = New-Object System.Drawing.Point(32, 80)
$edit.Size = New-Object System.Drawing.Size(900, 320)
$form.Controls.Add($edit)
$encoding = New-Object System.Text.UTF8Encoding($false, $false)
$edit.Add_TextChanged({ [IO.File]::WriteAllText((Join-Path $Folder 'text.txt'), $edit.Text, $encoding) })
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Test action'
$button.AccessibleName = 'Test action'
$button.Location = New-Object System.Drawing.Point(32, 430)
$button.Size = New-Object System.Drawing.Size(180, 50)
$button.Add_Click({ [IO.File]::WriteAllText((Join-Path $Folder 'clicked.txt'), 'clicked') })
$form.Controls.Add($button)
$cover = New-Object System.Windows.Forms.Form
$cover.Text = 'DSH Test covering window'
$cover.FormBorderStyle = 'None'
$cover.StartPosition = 'Manual'
$cover.ShowInTaskbar = $false
$cover.TopMost = $true
$decoy = New-Object System.Windows.Forms.Button
$decoy.Text = 'Covered target'
$decoy.Dock = 'Fill'
$decoy.Add_Click({ [IO.File]::WriteAllText((Join-Path $Folder 'decoy-clicked.txt'), 'clicked') })
$cover.Controls.Add($decoy)
for ($index = 0; $index -lt 22; $index++) {
    $candidate = New-Object System.Windows.Forms.Button
    $candidate.AccessibleName = if ($index -eq 0 -or $index -eq 21) { 'Ambiguous target' } else { 'Ambiguous target variant ' + $index }
    $candidate.Text = 'Candidate ' + $index
    $candidate.Location = New-Object System.Drawing.Point((250 + ($index % 5) * 132), (430 + [Math]::Floor($index / 5) * 26))
    $candidate.Size = New-Object System.Drawing.Size(128, 24)
    $form.Controls.Add($candidate)
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$script:presented = $false
$timer.Add_Tick({
    if (-not $script:presented) {
        $script:presented = $true
        $form.Hide()
        $form.Show()
        $form.Activate()
    }
    $requestPath = Join-Path $Folder 'request.json'
    if (Test-Path -LiteralPath $requestPath) {
        $request = [IO.File]::ReadAllText($requestPath) | ConvertFrom-Json
        $response = @{ id = $request.id }
        try {
            switch ($request.action) {
                'clipboard' { $response.sequence = [DshCuTest.ClipboardSequence]::GetClipboardSequenceNumber() }
                'cover' {
                    $cover.Bounds = $form.RectangleToScreen($button.Bounds)
                    $cover.Show($form)
                    $cover.BringToFront()
                }
                'uncover' { $cover.Hide(); $form.Activate() }
                default { throw 'unknown fixture action' }
            }
        } catch { $response.error = $_.Exception.Message }
        [IO.File]::WriteAllText((Join-Path $Folder 'response.tmp'), (ConvertTo-Json $response), $encoding)
        Remove-Item -LiteralPath $requestPath
        Move-Item -LiteralPath (Join-Path $Folder 'response.tmp') -Destination (Join-Path $Folder 'response.json') -Force
    }
    if (Test-Path (Join-Path $Folder 'stop')) { $form.Close() }
})
$form.Add_Shown({
    $edit.Focus()
    [IO.File]::WriteAllText((Join-Path $Folder 'ready.json'), (ConvertTo-Json @{ pid = $PID; title = $form.Text }))
    $timer.Start()
})
try { [System.Windows.Forms.Application]::Run($form) }
finally { $timer.Dispose(); $cover.Dispose(); $form.Dispose() }
