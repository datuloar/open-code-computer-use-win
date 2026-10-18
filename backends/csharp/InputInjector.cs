namespace DshCu
{

public static class InputInjector
{
    private const uint Mouse = 0;
    private const uint Keyboard = 1;
    private const int TextGapMs = 12;
    private const int SettleMs = 40;
    private const int TapMs = 40;
    private const int DragStepMs = 14;
    private const int MinDragSteps = 10;
    private const int MaxDragSteps = 48;

    private static readonly string[] ClickModes = new string[] { "left", "right", "middle", "double", "triple" };

    public static void Move(int x, int y)
    {
        MovePointer(x, y, 0);
        Console.WriteLine("MOVED " + x + "," + y);
    }

    public static void Click(int x, int y, string mode)
    {
        if (Array.IndexOf(ClickModes, mode) < 0)
        {
            throw new ArgumentException(
                "click mode must be left, right, middle, double or triple, got \"" + mode + "\"");
        }
        MovePointer(x, y, 60);
        if (mode == "right")
        {
            Tap(Native.MOUSEEVENTF_RIGHTDOWN, Native.MOUSEEVENTF_RIGHTUP);
        }
        else if (mode == "middle")
        {
            Tap(Native.MOUSEEVENTF_MIDDLEDOWN, Native.MOUSEEVENTF_MIDDLEUP);
        }
        else
        {
            int times = mode == "double" ? 2 : mode == "triple" ? 3 : 1;
            for (int index = 0; index < times; index++)
            {
                if (index > 0) System.Threading.Thread.Sleep(60);
                Tap(Native.MOUSEEVENTF_LEFTDOWN, Native.MOUSEEVENTF_LEFTUP);
            }
        }
        Console.WriteLine("CLICKED " + x + "," + y + " " + mode);
    }

    public static void Drag(int fromX, int fromY, int toX, int toY)
    {
        ValidatePoint(toX, toY);
        MovePointer(fromX, fromY, 90);
        MouseEvent(Native.MOUSEEVENTF_LEFTDOWN);
        System.Threading.Thread.Sleep(90);
        try
        {
            int steps = DragSteps(fromX, fromY, toX, toY);
            for (int step = 1; step <= steps; step++)
            {
                StateFiles.RequireInput();
                double progress = Theme.Smooth((double)step / steps);
                int x = (int)Math.Round(fromX + (toX - fromX) * progress);
                int y = (int)Math.Round(fromY + (toY - fromY) * progress);
                Native.SetCursorPos(x, y);
                System.Threading.Thread.Sleep(DragStepMs);
            }
            Native.SetCursorPos(toX, toY);
            System.Threading.Thread.Sleep(90);
        }
        finally
        {
            MouseEvent(Native.MOUSEEVENTF_LEFTUP);
        }
        Console.WriteLine("DRAGGED " + fromX + "," + fromY + " -> " + toX + "," + toY);
    }

    public static void Wheel(int delta)
    {
        SendWheel(delta, Native.MOUSEEVENTF_WHEEL);
        Console.WriteLine("WHEEL " + delta);
    }

    public static void WheelAt(int x, int y, int delta)
    {
        MovePointer(x, y, SettleMs);
        SendWheel(delta, Native.MOUSEEVENTF_WHEEL);
        Console.WriteLine("WHEEL " + delta + " at " + x + "," + y);
    }

    public static void WheelHorizontal(int delta)
    {
        SendWheel(delta, Native.MOUSEEVENTF_HWHEEL);
        Console.WriteLine("HWHEEL " + delta);
    }

    public static void WheelHorizontalAt(int x, int y, int delta)
    {
        MovePointer(x, y, SettleMs);
        SendWheel(delta, Native.MOUSEEVENTF_HWHEEL);
        Console.WriteLine("HWHEEL " + delta + " at " + x + "," + y);
    }

    public static void Type(string text)
    {
        int completed = 0;
        try
        {
            foreach (char character in text)
            {
                if (character == '\r') continue;
                if (character == '\n')
                {
                    Press("Enter");
                    Release("Enter");
                    completed++;
                    System.Threading.Thread.Sleep(TextGapMs);
                    continue;
                }
                if (character == '\t')
                {
                    Press("Tab");
                    Release("Tab");
                    completed++;
                    System.Threading.Thread.Sleep(TextGapMs);
                    continue;
                }
                KeyEvent(0, character, Native.KEYEVENTF_UNICODE, false);
                System.Threading.Thread.Sleep(TextGapMs);
                KeyEvent(0, character, Native.KEYEVENTF_UNICODE, true);
                completed++;
                System.Threading.Thread.Sleep(TextGapMs);
            }
        }
        catch (Exception error)
        {
            throw new InvalidOperationException("typing stopped after " + completed + " of " + text.Length +
                " chars in this chunk; inspect the field before retrying, because some text may already be present. " + error.Message, error);
        }
        Console.WriteLine("TYPED " + text.Length + " chars");
    }

    public static void Press(string name)
    {
        SendNamed(name, false);
    }

    public static void Release(string name)
    {
        SendNamed(name, true);
    }

    public static void Key(string name, string phase)
    {
        if (phase != "" && phase != "down" && phase != "up")
        {
            throw new ArgumentException("key phase must be down or up, got \"" + phase + "\"");
        }
        if (phase == "down") Press(name);
        else if (phase == "up") Release(name);
        else
        {
            Press(name);
            Release(name);
        }
        Console.WriteLine("KEY " + name + " " + phase);
    }

    private static int DragSteps(int fromX, int fromY, int toX, int toY)
    {
        double distance = Math.Sqrt(Math.Pow(toX - fromX, 2) + Math.Pow(toY - fromY, 2));
        int steps = (int)Math.Round(distance / 12);
        if (steps < MinDragSteps) return MinDragSteps;
        if (steps > MaxDragSteps) return MaxDragSteps;
        return steps;
    }

    private static void MovePointer(int x, int y, int settleMs)
    {
        StateFiles.RequireInput();
        ValidatePoint(x, y);
        if (!Native.SetCursorPos(x, y)) throw new InvalidOperationException("SetCursorPos failed");
        if (settleMs > 0) System.Threading.Thread.Sleep(settleMs);
    }

    private static void ValidatePoint(int x, int y)
    {
        if (x < -32767 || x > 32767 || y < -32767 || y > 32767)
            throw new ArgumentException("coordinates must be between -32767 and 32767");
        if (!Screen.PrimaryScreen.Bounds.Contains(x, y))
            throw new ArgumentException("the point is outside the primary screen; refresh the window or screenshot before acting");
    }

    private static void Tap(uint down, uint up)
    {
        MouseEvent(down);
        System.Threading.Thread.Sleep(TapMs);
        MouseEvent(up);
    }

    private static void SendWheel(int delta, uint flags)
    {
        if (delta == 0) throw new ArgumentException("wheel delta must not be zero");
        INPUT input = new INPUT();
        input.type = Mouse;
        input.u.mi.mouseData = unchecked((uint)delta);
        input.u.mi.dwFlags = flags;
        Send(input);
    }

    private static void SendNamed(string name, bool up)
    {
        ushort virtualKey;
        bool extended;
        Resolve(name, out virtualKey, out extended);
        if (virtualKey == 0) throw new ArgumentException("unknown key: " + name);
        KeyEvent(
            virtualKey,
            Native.MapVirtualKey(virtualKey, 0),
            extended ? Native.KEYEVENTF_EXTENDEDKEY : 0,
            up);
    }

    private static void MouseEvent(uint flags)
    {
        INPUT input = new INPUT();
        input.type = Mouse;
        input.u.mi.dwFlags = flags;
        Send(input);
    }

    private static void KeyEvent(ushort virtualKey, ushort scan, uint flags, bool up)
    {
        INPUT input = new INPUT();
        input.type = Keyboard;
        input.u.ki.wVk = virtualKey;
        input.u.ki.wScan = scan;
        input.u.ki.dwFlags = flags | (up ? Native.KEYEVENTF_KEYUP : 0);
        Send(input);
    }

    private static void Send(INPUT input)
    {
        bool releasing = input.type == Keyboard
            ? (input.u.ki.dwFlags & Native.KEYEVENTF_KEYUP) != 0
            : (input.u.mi.dwFlags & (Native.MOUSEEVENTF_LEFTUP | Native.MOUSEEVENTF_RIGHTUP | Native.MOUSEEVENTF_MIDDLEUP)) != 0;
        if (!releasing) StateFiles.RequireInput();
        INPUT[] batch = new INPUT[] { input };
        uint sent = Native.SendInput(1, batch, Marshal.SizeOf(typeof(INPUT)));
        if (sent != 1)
        {
            throw new InvalidOperationException("SendInput delivered " + sent + " of 1 events (error " +
                Marshal.GetLastWin32Error() + "); the focused window may be running elevated");
        }
    }

    private static void Resolve(string name, out ushort virtualKey, out bool extended)
    {
        virtualKey = 0;
        extended = false;
        if (string.IsNullOrEmpty(name)) return;

        string key = name.Trim().ToUpperInvariant();
        if (key.Length == 1)
        {
            char character = key[0];
            if ((character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9'))
            {
                virtualKey = character;
                return;
            }
        }

        if (key.Length >= 2 && key[0] == 'F')
        {
            int number;
            if (int.TryParse(key.Substring(1), out number) && number >= 1 && number <= 24)
            {
                virtualKey = (ushort)(0x6F + number);
                return;
            }
        }

        switch (key)
        {
            case "ENTER": case "RETURN": virtualKey = 0x0D; return;
            case "ESC": case "ESCAPE": virtualKey = 0x1B; return;
            case "TAB": virtualKey = 0x09; return;
            case "SPACE": virtualKey = 0x20; return;
            case "BACKSPACE": virtualKey = 0x08; return;
            case "DELETE": case "DEL": virtualKey = 0x2E; extended = true; return;
            case "INSERT": case "INS": virtualKey = 0x2D; extended = true; return;
            case "HOME": virtualKey = 0x24; extended = true; return;
            case "END": virtualKey = 0x23; extended = true; return;
            case "PAGEUP": case "PGUP": virtualKey = 0x21; extended = true; return;
            case "PAGEDOWN": case "PGDN": virtualKey = 0x22; extended = true; return;
            case "UP": virtualKey = 0x26; extended = true; return;
            case "DOWN": virtualKey = 0x28; extended = true; return;
            case "LEFT": virtualKey = 0x25; extended = true; return;
            case "RIGHT": virtualKey = 0x27; extended = true; return;
            case "CTRL": case "CONTROL": virtualKey = 0x11; return;
            case "SHIFT": virtualKey = 0x10; return;
            case "ALT": virtualKey = 0x12; return;
            case "WIN": case "LWIN": virtualKey = 0x5B; extended = true; return;
            case "CAPSLOCK": virtualKey = 0x14; return;
            case "NUMLOCK": virtualKey = 0x90; extended = true; return;
            case "PRINTSCREEN": virtualKey = 0x2C; extended = true; return;
            case "MENU": case "APPS": virtualKey = 0x5D; extended = true; return;
        }
    }
}
}
