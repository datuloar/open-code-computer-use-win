namespace DshCu
{

public class Indicator : ApplicationContext
{
    private const int HeartbeatEveryTicks = 12;
    private const double IdleMinutes = 1;
    private const int AnnounceAlpha = 255;
    private const double PulseSeconds = 2.6;
    private const double GlowBase = 196;
    private const double GlowAmplitude = 56;
    private const int GlowStep = 5;
    private const double ActionHoldSeconds = 2.8;
    private const double ActionFadeSeconds = 1.2;

    private readonly int _announceSeconds;
    private readonly bool _quiet;
    private readonly Stopwatch _clock = new Stopwatch();
    private readonly PointerRenderer _pointerRenderer;
    private readonly PanelState _state = new PanelState();

    private EdgeGlow _edge;
    private LayeredWindow _pointer;
    private PanelForm _panel;
    private Timer _timer;
    private IntPtr _hook;
    private Native.LowLevelKeyboardProc _hookProc;
    private bool _finished;
    private bool _escaped;
    private bool _touchSeen;
    private int _ticks;
    private long _actionStamp;
    private double _actionAt;
    private bool _ready;
    private System.Threading.Mutex _ownership;

    public Indicator(bool quiet, int announceSeconds, bool hideCursor)
    {
        _ownership = new System.Threading.Mutex(false, "Local\\DshCuIndicator");
        bool acquired;
        try { acquired = _ownership.WaitOne(0); }
        catch (System.Threading.AbandonedMutexException) { acquired = true; }
        if (!acquired)
        {
            _ownership.Dispose();
            _ownership = null;
            throw new InvalidOperationException("another indicator already owns the desktop");
        }
        _quiet = quiet;
        _announceSeconds = announceSeconds;
        _pointerRenderer = new PointerRenderer(System.Windows.Forms.Cursor.Position, hideCursor);
        if (System.IO.File.Exists(StateFiles.CursorHidden)) SystemCursors.Restore();

        StateFiles.Delete(StateFiles.Ready);
        StateFiles.Write(StateFiles.Touch, DateTime.UtcNow.ToString("O"));
        StateFiles.Write(StateFiles.Pid, Process.GetCurrentProcess().Id + " " + StartTicks());
        StateFiles.Write(StateFiles.Owner, Environment.GetEnvironmentVariable("DSH_CU_OWNER") ?? "");
        StateFiles.Delete(StateFiles.Action);
        if (hideCursor) SystemCursors.Hide();

        Rectangle screen = Screen.PrimaryScreen.Bounds;
        ShowChrome(screen);
        _pointer = new LayeredWindow(new Rectangle(0, 0, PointerRenderer.Size, PointerRenderer.Size));
        _pointer.Show();

        _hookProc = OnKeyDown;
        _hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, _hookProc, IntPtr.Zero, 0);
        if (_hook == IntPtr.Zero)
        {
            Dispose();
            throw new InvalidOperationException("could not install the ESC stop hook; refusing control");
        }
        _clock.Start();

        _timer = new Timer();
        _timer.Interval = Theme.TickMs;
        _timer.Tick += delegate { Tick(); };
        _timer.Start();
    }

    private static string StartTicks()
    {
        try { return Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString(); }
        catch { return "0"; }
    }

    private void ShowChrome(Rectangle screen)
    {
        _edge = new EdgeGlow(screen);
        _edge.Show();
        _edge.Present(AnnounceAlpha);
        _panel = new PanelForm(screen);
        _panel.Show();
        UpdatePanel();
    }

    private IntPtr OnKeyDown(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && IsEscapeKeyDown(wParam, lParam))
        {
            _escaped = true;
            StateFiles.Write(StateFiles.HumanStop, DateTime.UtcNow.ToString("O"));
            StateFiles.Delete(StateFiles.Ready);
            _finished = true;
            return (IntPtr)1;
        }
        return Native.CallNextHookEx(_hook, code, wParam, lParam);
    }

    private static bool IsEscapeKeyDown(IntPtr wParam, IntPtr lParam)
    {
        int message = wParam.ToInt32();
        if (message != Native.WM_KEYDOWN && message != Native.WM_SYSKEYDOWN) return false;
        KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        bool injected = (data.flags & Native.LLKHF_INJECTED) != 0;
        return data.vkCode == Native.VK_ESCAPE && !injected;
    }

    private void Tick()
    {
        try
        {
            if (StopRequested()) return;
            _ticks++;
            WriteHeartbeat();
            ReadAction();
            PresentChrome();
            if (!_ready && _clock.Elapsed.TotalSeconds >= _announceSeconds)
            {
                UpdatePanel();
                StateFiles.Write(StateFiles.Ready, StateFiles.Read(StateFiles.Pid));
                _ready = true;
                if (_quiet)
                {
                    _panel.Dispose();
                    _panel = null;
                    _edge.Dispose();
                    _edge = null;
                }
            }
            _pointerRenderer.Track(System.Windows.Forms.Cursor.Position, LeftButtonDown(), RightButtonDown());
            _pointerRenderer.Draw(_pointer);
        }
        catch
        {
            if (System.IO.File.Exists(StateFiles.CursorHidden)) SystemCursors.Restore();
            _finished = true;
        }
    }

    private bool StopRequested()
    {
        if (_finished || StateFiles.StopRequested())
        {
            if (_escaped) StateFiles.Write(StateFiles.HumanStop, DateTime.UtcNow.ToString("O"));
            StateFiles.Delete(StateFiles.Stop);
            ExitThread();
            return true;
        }
        ObserveTouchFile();
        if (IdleTimedOut())
        {
            ExitThread();
            return true;
        }
        return false;
    }

    private void ObserveTouchFile()
    {
        if (_touchSeen) return;
        try { _touchSeen = System.IO.File.Exists(StateFiles.Touch); }
        catch { }
    }

    private bool IdleTimedOut()
    {
        if (!_touchSeen) return _clock.Elapsed.TotalMinutes > IdleMinutes;
        return StateFiles.AgeSeconds(StateFiles.Touch) > IdleMinutes * 60;
    }

    private void WriteHeartbeat()
    {
        if (_ticks % HeartbeatEveryTicks != 0) return;
        StateFiles.Write(StateFiles.Heartbeat, DateTime.UtcNow.Ticks.ToString());
    }

    private void ReadAction()
    {
        if (_quiet || _ticks % 4 != 0) return;
        long stamp = StateFiles.Stamp(StateFiles.Action);
        if (stamp == 0 || stamp == _actionStamp) return;
        string text = StateFiles.Read(StateFiles.Action);
        if (text.Length == 0) return;
        _actionStamp = stamp;
        _actionAt = _clock.Elapsed.TotalSeconds;
        _state.Action = text;
    }

    private void PresentChrome()
    {
        if (_edge == null) return;
        double elapsed = _clock.Elapsed.TotalSeconds;
        bool announcing = elapsed < _announceSeconds;
        _edge.Present(announcing ? AnnounceAlpha : PulseAlpha(elapsed));
        if (_ticks % 2 == 0) UpdatePanel();
    }

    private void UpdatePanel()
    {
        if (_panel == null) return;
        double elapsed = _clock.Elapsed.TotalSeconds;
        _state.Announcing = elapsed < _announceSeconds;
        _state.SecondsLeft = SecondsLeft(elapsed);
        _state.Remaining = _announceSeconds <= 0
            ? 0
            : Theme.Clamp((_announceSeconds - elapsed) / _announceSeconds, 0, 1);
        _state.Pulse = Breath(elapsed);
        _state.ActionOpacity = ActionOpacity(elapsed);
        _panel.Update(_state);
    }

    private double ActionOpacity(double elapsed)
    {
        if (_state.Action.Length == 0) return 0;
        double age = elapsed - _actionAt;
        if (age <= ActionHoldSeconds) return 1;
        return Theme.Clamp(1 - (age - ActionHoldSeconds) / ActionFadeSeconds, 0, 1);
    }

    private int SecondsLeft(double elapsed)
    {
        return Math.Max(1, (int)Math.Ceiling(_announceSeconds - elapsed));
    }

    private static double Breath(double elapsed)
    {
        if (Theme.OpenCode) return 0.5;
        return 0.5 + 0.5 * Math.Sin(elapsed * (2 * Math.PI / PulseSeconds));
    }

    private static int PulseAlpha(double elapsed)
    {
        int alpha = (int)(GlowBase + GlowAmplitude * Breath(elapsed));
        return alpha / GlowStep * GlowStep;
    }

    private static bool LeftButtonDown()
    {
        return (Native.GetAsyncKeyState(0x01) & 0x8000) != 0;
    }

    private static bool RightButtonDown()
    {
        return (Native.GetAsyncKeyState(0x02) & 0x8000) != 0;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            StateFiles.Delete(StateFiles.Stop);
            StateFiles.Delete(StateFiles.Pid);
            StateFiles.Delete(StateFiles.Owner);
            StateFiles.Delete(StateFiles.Touch);
            StateFiles.Delete(StateFiles.Heartbeat);
            StateFiles.Delete(StateFiles.Ready);
            StateFiles.Delete(StateFiles.Action);
            if (System.IO.File.Exists(StateFiles.CursorHidden)) SystemCursors.Restore();
            if (_timer != null) { _timer.Stop(); _timer.Dispose(); }
            if (_hook != IntPtr.Zero) Native.UnhookWindowsHookEx(_hook);
            if (_pointerRenderer != null) _pointerRenderer.Dispose();
            if (_pointer != null) _pointer.Dispose();
            if (_panel != null) _panel.Dispose();
            if (_edge != null) _edge.Dispose();
            if (_ownership != null) { _ownership.ReleaseMutex(); _ownership.Dispose(); _ownership = null; }
        }
        base.Dispose(disposing);
    }
}
}
