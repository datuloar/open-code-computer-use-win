param(
    [Parameter(Position = 0)][string]$Command,
    [Parameter(Position = 1)][string]$A1,
    [Parameter(Position = 2)][string]$A2,
    [Parameter(Position = 3)][string]$A3,
    [Parameter(Position = 4)][string]$A4,
    [Parameter(Position = 5)][string]$A5,
    [Parameter(Position = 6)][string]$A6,
    [int]$Announce = 8,
    [int]$Depth = 6,
    [string]$TargetPid = '',
    [string]$TargetTitle = '',
    [string]$Language = '',
    [switch]$Quiet,
    [switch]$Horizontal,
    [switch]$HideCursor,
    [switch]$All,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$operands = New-Object System.Collections.ArrayList

function Set-Invocation {
    param([object[]]$Arguments)
    $script:Command = [string]$Arguments[0]
    $script:operands = New-Object System.Collections.ArrayList
    $script:Announce = 8
    $script:Depth = 6
    $script:TargetPid = ''
    $script:TargetTitle = ''
    $script:Language = ''
    $script:Quiet = $false
    $script:Horizontal = $false
    $script:HideCursor = $false
    $script:All = $false
    $script:Json = $false
    $flags = switch ($script:Command) {
        { $_ -in @('tree', 'find', 'tap') } { @('-Depth', '-TargetPid', '-TargetTitle', '-All', '-Json') }
        { $_ -in @('overlay', 'overlay-start') } { @('-Announce', '-Quiet', '-HideCursor') }
        'read' { @('-Language', '-Json') }
        'wheel' { @('--horizontal') }
        default { @() }
    }
    for ($index = 1; $index -lt $Arguments.Count; $index++) {
        $argument = [string]$Arguments[$index]
        if ($argument -notin $flags -or ($index -eq 1 -and $script:Command -in @('find', 'tap'))) {
            [void]$script:operands.Add($argument)
            continue
        }
        $next = if ($index + 1 -lt $Arguments.Count) { [string]$Arguments[$index + 1] } else { $null }
        switch ($argument) {
            '-Announce' { $index++; if ($null -ne $next) { $script:Announce = [int]$next } }
            '-Depth' { $index++; if ($null -ne $next) { $script:Depth = [int]$next } }
            '-TargetPid' { $index++; if ($null -ne $next) { $script:TargetPid = $next } }
            '-TargetTitle' { $index++; if ($null -ne $next) { $script:TargetTitle = $next } }
            '-Language' { $index++; if ($null -ne $next) { $script:Language = $next } }
            '-Quiet' { $script:Quiet = $true }
            '-HideCursor' { $script:HideCursor = $true }
            '-All' { $script:All = $true }
            '-Json' { $script:Json = $true }
            '--horizontal' { $script:Horizontal = $true }
            default { [void]$script:operands.Add($argument) }
        }
    }
}

if ($env:DSH_CU_ARGV) {
    Set-Invocation @((ConvertFrom-Json $env:DSH_CU_ARGV))
    Remove-Item Env:\DSH_CU_ARGV -ErrorAction SilentlyContinue
} else {
    foreach ($argument in @($A1, $A2, $A3, $A4, $A5, $A6)) {
        if ($null -ne $argument -and $argument -ne '') { [void]$operands.Add($argument) }
    }
}

function Arg([int]$index) {
    if ($index -lt $script:operands.Count) { return [string]$script:operands[$index] }
    return ''
}

$sources = @(
    'Interop',
    'Theme',
    'StateFiles',
    'InputInjector',
    'LayeredWindow',
    'PanelState',
    'PanelRenderer',
    'PanelForm',
    'FrameRenderer',
    'EdgeGlow',
    'PointerRenderer',
    'Indicator',
    'SystemCursors',
    'UiTree'
)
$source = ($sources | ForEach-Object { Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "csharp\$_.cs") }) -join "`n"
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes, WindowsBase
[DshCu.Native]::EnableDpiAwareness()

$FreshSeconds = 5

$stopFile = [DshCu.StateFiles]::Stop
$aliveFile = [DshCu.StateFiles]::Heartbeat
$pidFile = [DshCu.StateFiles]::Pid
$cursorFile = [DshCu.StateFiles]::CursorHidden
$actionFile = [DshCu.StateFiles]::Action
$brokerReady = [DshCu.StateFiles]::BrokerReady
$brokerStop = [DshCu.StateFiles]::BrokerStop
$brokerRequests = [DshCu.StateFiles]::InTemp('dsh-cu.broker.req.*')
$brokerAnswers = [DshCu.StateFiles]::InTemp('dsh-cu.broker.res.*')

trap {
    Write-Output ("ERROR " + $_.Exception.Message)
    exit 1
}

function Get-StateAge([string]$path) {
    return [DshCu.StateFiles]::AgeSeconds($path)
}

function Get-StateText([string]$path) {
    return [DshCu.StateFiles]::Read($path)
}

function Test-Integer([string]$value, [string]$name) {
    if ([string]::IsNullOrWhiteSpace($value)) { throw "$name is required" }
    if ($value -notmatch '^-?\d+$') { throw "$name must be an integer, got `"$value`"" }
    return [int]$value
}

function Get-VisibleWindow {
    param([string]$TitleLike)
    $windows = Get-Process | Where-Object {
        $_.MainWindowHandle -ne 0 -and
        [DshCu.Native]::IsWindowVisible($_.MainWindowHandle) -and
        $_.MainWindowTitle -ne ''
    }
    if ($TitleLike) {
        $pattern = '*' + [System.Management.Automation.WildcardPattern]::Escape($TitleLike) + '*'
        $windows = $windows | Where-Object { $_.MainWindowTitle -like $pattern }
    }
    return $windows | Sort-Object ProcessName
}

function Set-Foreground($process) {
    $handle = $process.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { throw "process $($process.Id) has no window" }
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        [DshCu.StateFiles]::RequireInput()
        if ($attempt -eq 1) { (New-Object -ComObject WScript.Shell).AppActivate($process.Id) | Out-Null }
        if ([DshCu.Native]::FocusVerified($handle)) {
            Write-Output ("FOCUSED " + $process.MainWindowTitle)
            return
        }
        Start-Sleep -Milliseconds 180
    }
    throw "could not bring pid $($process.Id) to the foreground: another window keeps focus"
}

function Test-IndicatorProcess($process, [long]$startedTicks) {
    if (-not $process) { return $false }
    if ($process.ProcessName -ne 'powershell') { return $false }
    if ($startedTicks -le 0) { return $false }
    try {
        $drift = [Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $startedTicks)
        return ($drift -lt (5 * [TimeSpan]::TicksPerSecond))
    } catch {
        return $false
    }
}

function Assert-ClientOwnership {
    if (-not $env:DSH_CU_OWNER) { return }
    if ((Get-StateText ([DshCu.StateFiles]::Owner)) -eq $env:DSH_CU_OWNER) { return }
    $fields = (Get-StateText $pidFile) -split '\s+'
    $recordedPid = 0
    $recordedStart = 0L
    [void][int]::TryParse($fields[0], [ref]$recordedPid)
    if ($fields.Count -ge 2) { [void][long]::TryParse($fields[1], [ref]$recordedStart) }
    $recordedProcess = if ($recordedPid -gt 0) { Get-Process -Id $recordedPid -ErrorAction SilentlyContinue } else { $null }
    if (Test-IndicatorProcess $recordedProcess $recordedStart) {
        throw 'another computer-use client owns the desktop; wait for it to stop'
    }
}

function Clear-Indicator {
    $fields = (Get-StateText $pidFile) -split '\s+'
    $owner = 0
    $ownerStarted = 0
    [void][int]::TryParse($fields[0], [ref]$owner)
    if ($fields.Count -ge 2) { [void][long]::TryParse($fields[1], [ref]$ownerStarted) }
    $process = if ($owner -gt 0) { Get-Process -Id $owner -ErrorAction SilentlyContinue } else { $null }
    if (Test-IndicatorProcess $process $ownerStarted) {
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 100
            if (-not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { break }
        }
        $current = Get-Process -Id $owner -ErrorAction SilentlyContinue
        if (Test-IndicatorProcess $current $ownerStarted) { Stop-Process -InputObject $current -Force -ErrorAction SilentlyContinue }
    }
    if (Test-Path $cursorFile) { [DshCu.SystemCursors]::Restore() }
    Remove-Item $aliveFile, $stopFile, $pidFile, $actionFile, ([DshCu.StateFiles]::Ready), ([DshCu.StateFiles]::Owner) -Force -ErrorAction SilentlyContinue
}

function Resolve-UiWindow {
    if ($TargetPid) { return [DshCu.UiTree]::Usable([DshCu.UiTree]::ForPid((Test-Integer $TargetPid 'pid'))) }
    if ($TargetTitle) { return [DshCu.UiTree]::Usable([DshCu.UiTree]::ForTitle($TargetTitle)) }
    return [DshCu.UiTree]::Usable([DshCu.UiTree]::Foreground())
}

function Get-CaptureArea {
    param([int]$Index)
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if (-not (Arg $Index)) { return $bounds }
    $area = New-Object System.Drawing.Rectangle(
        (Test-Integer (Arg $Index) 'region x'),
        (Test-Integer (Arg ($Index + 1)) 'region y'),
        (Test-Integer (Arg ($Index + 2)) 'region width'),
        (Test-Integer (Arg ($Index + 3)) 'region height'))
    $area = [System.Drawing.Rectangle]::Intersect($area, $bounds)
    if ($area.Width -le 0 -or $area.Height -le 0) { throw 'the capture region is outside the screen' }
    return $area
}

function New-ScreenBitmap {
    param([System.Drawing.Rectangle]$Area, [int]$Zoom)
    $shot = New-Object System.Drawing.Bitmap $Area.Width, $Area.Height
    $graphics = [System.Drawing.Graphics]::FromImage($shot)
    try { $graphics.CopyFromScreen($Area.X, $Area.Y, 0, 0, $shot.Size) } finally { $graphics.Dispose() }
    if ($Zoom -le 1) { return $shot }
    $scaled = New-Object System.Drawing.Bitmap ($Area.Width * $Zoom), ($Area.Height * $Zoom)
    $graphics = [System.Drawing.Graphics]::FromImage($scaled)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($shot, 0, 0, $scaled.Width, $scaled.Height)
    } finally {
        $graphics.Dispose()
        $shot.Dispose()
    }
    return $scaled
}

function Get-OcrEngine {
    param([string]$Tag)
    [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    [void][Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
    if (-not $Tag) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if (-not $engine) { throw 'Windows OCR has no language pack for this user profile' }
        return $engine
    }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language($Tag)))
    if (-not $engine) {
        $installed = ([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) -join ', '
        throw "Windows OCR has no pack for $Tag (installed: $installed)"
    }
    return $engine
}

function Invoke-WinRt {
    param($Operation, [type]$ResultType)
    if (-not $script:AsTaskMethod) {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $script:AsTaskMethod = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]
    }
    return $script:AsTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation)).GetAwaiter().GetResult()
}

function Read-ScreenText {
    param([System.Drawing.Rectangle]$Area)
    $zoom = if ($Area.Width -lt 900 -or $Area.Height -lt 500) { 2 } else { 1 }
    $file = [DshCu.StateFiles]::InTemp("dsh-cu.ocr.$PID.png")
    $bitmap = New-ScreenBitmap $Area $zoom
    try { $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
    try {
        $engine = Get-OcrEngine $Language
        [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
        $handle = Invoke-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
        $stream = Invoke-WinRt ($handle.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        try {
            $decoder = Invoke-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $software = Invoke-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            $result = Invoke-WinRt ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
        } finally {
            $stream.Dispose()
        }
        $lines = New-Object System.Collections.ArrayList
        foreach ($line in $result.Lines) {
            $left = [double]::MaxValue
            $top = [double]::MaxValue
            $right = [double]::MinValue
            $bottom = [double]::MinValue
            foreach ($word in $line.Words) {
                $box = $word.BoundingRect
                if ($box.X -lt $left) { $left = $box.X }
                if ($box.Y -lt $top) { $top = $box.Y }
                if (($box.X + $box.Width) -gt $right) { $right = $box.X + $box.Width }
                if (($box.Y + $box.Height) -gt $bottom) { $bottom = $box.Y + $box.Height }
            }
            if ($right -le $left) { continue }
            [void]$lines.Add([pscustomobject]@{
                text = $line.Text
                left = [int]($Area.X + $left / $zoom)
                top = [int]($Area.Y + $top / $zoom)
                width = [int](($right - $left) / $zoom)
                height = [int](($bottom - $top) / $zoom)
                x = [int]($Area.X + ($left + $right) / (2 * $zoom))
                y = [int]($Area.Y + ($top + $bottom) / (2 * $zoom))
            })
        }
        return [pscustomobject]@{
            language = $engine.RecognizerLanguage.LanguageTag
            zoom = $zoom
            area = $Area
            lines = $lines
        }
    } finally {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}

function Get-ActionLabel {
    $x = Arg 0
    $y = Arg 1
    switch ($Command) {
        'shot' { return 'screenshot' }
        'move' { return "move $x,$y" }
        'click' {
            $mode = if (Arg 2) { Arg 2 } else { 'left' }
            if ($mode -eq 'left') { return "click $x,$y" }
            return "$mode click $x,$y"
        }
        'drag' { return ("drag $x,$y " + [char]0x2192 + " " + (Arg 2) + "," + (Arg 3)) }
        'wheel' {
            $axis = if ($Horizontal) { 'scroll sideways' } else { 'scroll' }
            if ((Arg 1) -and (Arg 2)) { return "$axis $x at $(Arg 1),$(Arg 2)" }
            return "$axis $x"
        }
        'type' { return ("type " + $x.Length + " chars") }
        'key' { return ("key " + $x + " " + $y).Trim() }
        'keys' { return "keys $x" }
        'clipboard' { return ("clipboard " + $(if ($x) { $x } else { 'get' })) }
        'run' { return "run $x" }
        'read' { return 'read the screen' }
        'tree' { return 'read the window tree' }
        'find' { return "find $x" }
        'tap' { return "click $x" }
        'focus' { return "focus pid $x" }
        'focus-title' { return "focus $x" }
        'wait-window' { return "wait for $x" }
    }
    return ''
}

function Save-Screenshot([string]$path, [System.Drawing.Rectangle]$area) {
    if ($area.Width -le 0 -or $area.Height -le 0) { throw 'the capture region must be at least 1x1' }
    $bitmap = New-Object System.Drawing.Bitmap $area.Width, $area.Height
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($area.X, $area.Y, 0, 0, $bitmap.Size)
        } finally {
            $graphics.Dispose()
        }
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $bitmap.Dispose()
    }
    Write-Output ("CAPTURED " + $area.Width + "x" + $area.Height + " at " + $area.X + "," + $area.Y)
}

function Invoke-Dispatch {
    if ($script:Serving -and (($Command -eq 'overlay' -and (Arg 0) -notin @('stop', 'restore-cursor')) -or
            $Command -in @('broker-loop', 'serve'))) {
        throw "$Command runs in its own process and cannot be sent to a serving backend"
    }
    $label = Get-ActionLabel
    if ($label) { [DshCu.StateFiles]::Write($actionFile, $label) }

    switch ($Command) {
        'shot' {
            $path = Arg 0
            if ([string]::IsNullOrWhiteSpace($path)) { throw 'shot needs a destination path' }
            Save-Screenshot $path (Get-CaptureArea 1)
        }
        'read' {
            $reading = Read-ScreenText (Get-CaptureArea 0)
            if ($Json) {
                Write-Output (ConvertTo-Json -InputObject ([pscustomobject]@{
                    language = $reading.language
                    lines = @($reading.lines)
                }) -Depth 4 -Compress)
            } else {
                Write-Output ("READ " + @($reading.lines).Count + " lines (" + $reading.language + ", " +
                    $reading.area.Width + "x" + $reading.area.Height + " at " + $reading.area.X + "," + $reading.area.Y + ")")
                foreach ($line in $reading.lines) {
                    Write-Output ("[" + $line.x + "," + $line.y + "] " + $line.text)
                }
            }
        }
        'tree' {
            Write-Output ([DshCu.UiTree]::Dump((Resolve-UiWindow), $Depth, [bool]$All, [bool]$Json))
        }
        'find' {
            $needle = Arg 0
            if ([string]::IsNullOrWhiteSpace($needle)) { throw 'find needs the text to look for' }
            Write-Output ([DshCu.UiTree]::Search((Resolve-UiWindow), $needle, [bool]$Json))
        }
        'tap' {
            $needle = Arg 0
            if ([string]::IsNullOrWhiteSpace($needle)) { throw 'tap needs the name of the control to click' }
            $window = Resolve-UiWindow
            $node = [DshCu.UiTree]::Only($window, $needle)
            [DshCu.UiTree]::EnsureVisibleAt($window, $node.CenterX, $node.CenterY)
            [DshCu.InputInjector]::Click($node.CenterX, $node.CenterY, 'left')
            Write-Output ("TAPPED " + $node.Role + " '" + $node.Label() + "' at " + $node.CenterX + "," + $node.CenterY)
        }
        'move' { [DshCu.InputInjector]::Move((Test-Integer (Arg 0) 'x'), (Test-Integer (Arg 1) 'y')) }
        'click' {
            $mode = if (Arg 2) { Arg 2 } else { 'left' }
            [DshCu.InputInjector]::Click((Test-Integer (Arg 0) 'x'), (Test-Integer (Arg 1) 'y'), $mode)
        }
        'drag' {
            [DshCu.InputInjector]::Drag(
                (Test-Integer (Arg 0) 'x'),
                (Test-Integer (Arg 1) 'y'),
                (Test-Integer (Arg 2) 'to x'),
                (Test-Integer (Arg 3) 'to y'))
        }
        'wheel' {
            $delta = Test-Integer (Arg 0) 'delta'
            $at = (Arg 1) -and (Arg 2)
            if ($Horizontal) {
                if ($at) {
                    [DshCu.InputInjector]::WheelHorizontalAt((Test-Integer (Arg 1) 'x'), (Test-Integer (Arg 2) 'y'), $delta)
                } else {
                    [DshCu.InputInjector]::WheelHorizontal($delta)
                }
            } elseif ($at) {
                [DshCu.InputInjector]::WheelAt((Test-Integer (Arg 1) 'x'), (Test-Integer (Arg 2) 'y'), $delta)
            } else {
                [DshCu.InputInjector]::Wheel($delta)
            }
        }
        'type' { [DshCu.InputInjector]::Type((Arg 0)) }
        'key' { [DshCu.InputInjector]::Key((Arg 0), (Arg 1)) }
        'keys' {
            $combo = Arg 0
            $parts = $combo -split '\+'
            $modifiers = @('ctrl', 'shift', 'alt', 'win')
            $held = @()
            try {
            for ($index = 0; $index -lt $parts.Count - 1; $index++) {
                $name = $parts[$index].Trim()
                if ($modifiers -notcontains $name.ToLowerInvariant()) { throw "unknown modifier: $name" }
                [DshCu.InputInjector]::Press($name)
                $held += $name
            }
            $tapKey = $parts[-1].Trim()
            [DshCu.InputInjector]::Press($tapKey)
            [DshCu.InputInjector]::Release($tapKey)
            } finally {
                for ($index = $held.Count - 1; $index -ge 0; $index--) { [DshCu.InputInjector]::Release($held[$index]) }
            }
            Write-Output ('KEYS ' + $combo)
        }
        'clipboard' {
            [DshCu.StateFiles]::RequireInput()
            $action = Arg 0
            if ($action -eq 'set') {
                Set-Clipboard -Value (Arg 1)
                Write-Output 'CLIPBOARD SET'
            } elseif ($action -eq 'clear') {
                try { [System.Windows.Forms.Clipboard]::Clear() }
                catch { Set-Clipboard -Value ' ' }
                Write-Output 'CLIPBOARD CLEARED'
            } else {
                Write-Output ('CLIPBOARD ' + (Get-Clipboard -Raw))
            }
        }
        'pos' {
            $point = New-Object DshCu.POINT
            [void][DshCu.Native]::GetCursorPos([ref]$point)
            Write-Output ("CURSOR " + $point.X + "," + $point.Y)
            Write-Output ("FOREGROUND " + [DshCu.Native]::ForegroundWindowTitle())
        }
        'windows' {
            Get-VisibleWindow | Select-Object Id, ProcessName, MainWindowTitle |
                Format-Table -AutoSize | Out-String -Width 200
        }
        'windows-json' {
            $entries = @(Get-VisibleWindow | ForEach-Object {
            if ([DshCu.Native]::IsIconic($_.MainWindowHandle)) {
                [pscustomobject]@{ pid = $_.Id; title = $_.MainWindowTitle; minimized = $true }
            } else {
                $rect = New-Object DshCu.RECT
                [void][DshCu.Native]::GetWindowRect($_.MainWindowHandle, [ref]$rect)
                [pscustomobject]@{
                    pid = $_.Id
                    title = $_.MainWindowTitle
                    left = $rect.Left
                    top = $rect.Top
                    width = $rect.Right - $rect.Left
                    height = $rect.Bottom - $rect.Top
                }
            }
        })
            if ($entries.Count -eq 0) { Write-Output '[]' }
            else { Write-Output (ConvertTo-Json -InputObject $entries -Compress) }
        }
        'display' {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            Write-Output ("DISPLAY " + $bounds.Width + "x" + $bounds.Height + " dpi=" + [DshCu.Native]::SystemDpi())
        }
        'focus' {
            $target = Test-Integer (Arg 0) 'pid'
            Set-Foreground (Get-Process -Id $target -ErrorAction Stop)
        }
        'focus-title' {
            $matches = @(Get-VisibleWindow (Arg 0))
            if ($matches.Count -gt 1) { throw 'multiple windows match the title; use a pid or a more specific title' }
            $match = $matches | Select-Object -First 1
            if (-not $match) { throw "no window title contains $(Arg 0)" }
            Set-Foreground $match
        }
        'wait-window' {
            $title = Arg 0
            $seconds = if (Arg 1) { Test-Integer (Arg 1) 'seconds' } else { 15 }
            $deadline = (Get-Date).AddSeconds($seconds)
            while ((Get-Date) -lt $deadline) {
                [DshCu.StateFiles]::RequireInput()
                $matches = @(Get-VisibleWindow $title)
                if ($matches.Count -gt 1) { throw 'multiple windows match the title; use a pid or a more specific title' }
                $match = $matches | Select-Object -First 1
                if ($match) {
                    Set-Foreground $match
                    return
                }
                Start-Sleep -Milliseconds 400
            }
            throw "no window title contains $title within $seconds seconds"
        }
        'broker-start' {
            [DshCu.StateFiles]::RequireInput()
            $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), 'broker-loop')
            Start-Process powershell -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden | Out-Null
            Write-Output 'BROKER_STARTED'
        }
        'broker-loop' {
            Remove-Item $brokerStop -Force -ErrorAction SilentlyContinue
            Remove-Item $brokerAnswers -Force -ErrorAction SilentlyContinue
            while (-not (Test-Path $brokerStop)) {
                Set-Content -Path $brokerReady -Value ([DateTime]::Now.ToString('O'))
                $request = Get-ChildItem $brokerRequests -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -match '^dsh-cu\.broker\.req\.\d+$' } |
                    Sort-Object LastWriteTime | Select-Object -First 1
                if (-not $request) {
                    Start-Sleep -Milliseconds 150
                    continue
                }
                $payload = Get-StateText $request.FullName
                $responsePath = [DshCu.StateFiles]::InTemp(($request.Name -replace '\.req\.', '.res.'))
                Remove-Item $request.FullName -Force -ErrorAction SilentlyContinue
                $result = ''
                try {
                    $env:DSH_CU_ARGV = $payload
                    $result = (& powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath 2>&1 | Out-String)
                } catch {
                    $result = 'ERROR ' + $_.Exception.Message
                } finally {
                    Remove-Item Env:\DSH_CU_ARGV -ErrorAction SilentlyContinue
                }
                $stagedResponse = $responsePath + '.tmp'
                [IO.File]::WriteAllText($stagedResponse, $result, (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $stagedResponse -Destination $responsePath -Force
            }
            Remove-Item $brokerReady, $brokerStop -Force -ErrorAction SilentlyContinue
            Remove-Item $brokerAnswers -Force -ErrorAction SilentlyContinue
            Write-Output 'BROKER_STOPPED'
        }
        'broker-stop' {
            [DshCu.StateFiles]::RequireInput()
            Set-Content -Path $brokerStop -Value 'stop'
            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                Start-Sleep -Milliseconds 150
                if (-not (Test-Path $brokerReady)) { break }
            }
            Remove-Item $brokerReady, $brokerStop -Force -ErrorAction SilentlyContinue
            Write-Output 'BROKER_STOPPED'
        }
        'broker-state' {
            if ((Get-StateAge $brokerReady) -lt $FreshSeconds) { Write-Output 'BROKER_RUNNING' }
            else { Write-Output 'BROKER_STOPPED' }
        }
        'run' {
            [DshCu.StateFiles]::RequireInput()
            $previous = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $output = (& cmd /c (Arg 0) 2>&1 | ForEach-Object {
                    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
                } | Out-String)
            } finally {
                $ErrorActionPreference = $previous
            }
            $code = $LASTEXITCODE
            Write-Output $output.TrimEnd()
            Write-Output ("EXIT " + $code)
        }
        'overlay-start' {
            $startupLock = New-Object System.Threading.Mutex($false, 'Local\DshCuIndicatorStart')
            $locked = $false
            try {
                try { $locked = $startupLock.WaitOne(20000) }
                catch [System.Threading.AbandonedMutexException] { $locked = $true }
                if (-not $locked) { throw 'another indicator startup is still in progress' }
                Assert-ClientOwnership
                [DshCu.StateFiles]::Write($stopFile, 'stop')
                Clear-Indicator
                $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), 'overlay', '-Announce', "$Announce")
                if ($Quiet) { $arguments += '-Quiet' }
                if ($HideCursor) { $arguments += '-HideCursor' }
                $indicatorProcess = Start-Process powershell -ArgumentList $arguments -WindowStyle Hidden -PassThru
                for ($attempt = 0; $attempt -lt 60; $attempt++) {
                    Start-Sleep -Milliseconds 250
                    if ($indicatorProcess.HasExited) { throw 'the indicator stopped during the announcement or failed to start' }
                    if ((Get-StateAge $aliveFile) -lt $FreshSeconds) {
                        Write-Output 'RUNNING'
                        return
                    }
                }
                throw 'the indicator did not come up'
            } finally {
                if ($locked) { $startupLock.ReleaseMutex() }
                $startupLock.Dispose()
            }
        }
        'overlay-state' {
            if ((Get-StateAge $aliveFile) -gt $FreshSeconds) { Write-Output 'STOPPED' } else { Write-Output 'RUNNING' }
            return
        }
        'cursor-state' {
            if (Test-Path $cursorFile) { Write-Output 'CURSOR_REPLACED' }
            elseif ([DshCu.Native]::CursorIsShowing()) { Write-Output 'CURSOR_VISIBLE' }
            else { Write-Output 'CURSOR_HIDDEN_BY_OTHER' }
        }
        'overlay' {
            $mode = Arg 0
            if ($mode -eq 'stop' -or $mode -eq 'restore-cursor') {
                $stopLock = New-Object System.Threading.Mutex($false, 'Local\DshCuIndicatorStart')
                $locked = $false
                try {
                    try { $locked = $stopLock.WaitOne(20000) }
                    catch [System.Threading.AbandonedMutexException] { $locked = $true }
                    if (-not $locked) { throw 'another indicator startup is still in progress' }
                    Assert-ClientOwnership
                    if ($mode -eq 'stop') { Set-Content -Path $stopFile -Value ([DateTime]::Now.ToString('O')) }
                    Clear-Indicator
                    if ($mode -eq 'restore-cursor') { [DshCu.SystemCursors]::Restore() }
                    if ($mode -eq 'stop') { Write-Output 'STOPPED' } else { Write-Output 'CURSOR_RESTORED' }
                    return
                } finally {
                    if ($locked) { $stopLock.ReleaseMutex() }
                    $stopLock.Dispose()
                }
            }
            if (Test-Path $stopFile) { Remove-Item $stopFile -Force }
            Clear-Indicator
            $context = New-Object DshCu.Indicator($Quiet, $Announce, [bool]$HideCursor)
            [System.Windows.Forms.Application]::Run($context)
            if (Test-Path $cursorFile) { [DshCu.SystemCursors]::Restore() }
            Write-Output 'OVERLAY_CLOSED'
        }
        default { throw "unknown command: $Command" }
    }
}

function Invoke-Serve {
    $script:Serving = $true
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    $end = [string][char]0x1E + 'DSH-CU-END'
    [Console]::Out.WriteLine($end + ' READY')
    [Console]::Out.Flush()
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ($line.Trim().Length -eq 0) { continue }
        $status = 0
        try {
            Set-Invocation @((ConvertFrom-Json $line))
            Invoke-Dispatch | ForEach-Object { [Console]::Out.WriteLine([string]$_) }
        } catch {
            [Console]::Out.WriteLine('ERROR ' + $_.Exception.Message)
            $status = 1
        }
        [Console]::Out.WriteLine($end + ' ' + $status)
        [Console]::Out.Flush()
    }
}

$Serving = $false
if ($Command -eq 'serve') {
    Invoke-Serve
} else {
    Invoke-Dispatch
}
