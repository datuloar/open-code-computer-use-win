namespace DshCu
{

public static class UiTree
{
    public const int DefaultDepth = 6;

    private const int NodeCap = 400;
    private const int TreeCap = 120;
    private const int MatchCap = 20;
    private const int SearchDepth = 14;
    private const int WarmupMs = 260;
    private const int WarmupAttempts = 8;

    public static AutomationElement Foreground()
    {
        IntPtr handle = Native.GetForegroundWindow();
        if (handle == IntPtr.Zero) throw new InvalidOperationException("there is no foreground window");
        AutomationElement window = AutomationElement.FromHandle(handle);
        if (window == null) throw new InvalidOperationException("the foreground window exposes no UI tree");
        return window;
    }

    public static AutomationElement ForPid(int pid)
    {
        AutomationElement match = AutomationElement.RootElement.FindFirst(
            TreeScope.Children,
            new PropertyCondition(AutomationElement.ProcessIdProperty, pid));
        if (match == null) throw new InvalidOperationException("process " + pid + " has no top-level window");
        return match;
    }

    public static AutomationElement ForTitle(string text)
    {
        AutomationElementCollection windows = AutomationElement.RootElement.FindAll(
            TreeScope.Children,
            Condition.TrueCondition);
        AutomationElement match = null;
        for (int index = 0; index < windows.Count; index++)
        {
            string name = Safe(windows[index], false);
            if (name.Length == 0 || !name.ToLowerInvariant().Contains(text.ToLowerInvariant())) continue;
            if (match != null) throw new InvalidOperationException("multiple windows match the title; use a pid or a more specific title");
            match = windows[index];
        }
        if (match != null) return match;
        throw new InvalidOperationException("no window title contains " + text);
    }

    public static AutomationElement Usable(AutomationElement window)
    {
        IntPtr handle = Handle(window);
        if (handle != IntPtr.Zero && Native.IsIconic(handle))
        {
            throw new InvalidOperationException(
                "\"" + Describe(window) + "\" is minimised, so its controls have no place on screen - " +
                "bring it up with dsh-cu focus first");
        }
        return window;
    }

    public static string Describe(AutomationElement window)
    {
        string name = Safe(window, false);
        return name.Length > 0 ? name : "(untitled window)";
    }

    public static string Dump(AutomationElement window, int maxDepth, bool all, bool json)
    {
        List<Node> nodes = Collect(window, maxDepth, all, TreeCap + 1);
        bool truncated = nodes.Count > TreeCap;
        if (truncated) nodes.RemoveAt(nodes.Count - 1);
        if (json) return Json(nodes);
        StringBuilder text = new StringBuilder();
        text.AppendLine("TREE " + Describe(window) + " (" + nodes.Count + " elements, depth " + maxDepth + ")");
        for (int index = 0; index < nodes.Count; index++) text.AppendLine(nodes[index].Line());
        if (truncated)
        {
            text.AppendLine("... cut at " + TreeCap + " elements: narrow it with dsh-cu find <text> or a smaller --depth");
        }
        return text.ToString().TrimEnd();
    }

    public static string Search(AutomationElement window, string needle, bool json)
    {
        List<Node> matches = Matches(window, needle);
        bool truncated = matches.Count > MatchCap;
        if (truncated) matches.RemoveRange(MatchCap, matches.Count - MatchCap);
        if (json) return Json(matches);
        StringBuilder text = new StringBuilder();
        text.AppendLine("FOUND " + matches.Count + " for \"" + needle + "\" in " + Describe(window));
        for (int index = 0; index < matches.Count; index++) text.AppendLine(matches[index].Line().TrimStart());
        if (truncated) text.AppendLine("... more matches exist; use a more specific name");
        return text.ToString().TrimEnd();
    }

    public static Node Only(AutomationElement window, string needle)
    {
        Node node = Select(window, needle, false);
        if (!node.Enabled) throw new InvalidOperationException("the named control is disabled; wait for it to become enabled");
        return node;
    }

    public static Node Optional(AutomationElement window, string needle)
    {
        return Select(window, needle, true);
    }

    private static Node Select(AutomationElement window, string needle, bool optional)
    {
        List<Node> matches = Matches(window, needle);
        if (matches.Count == 0)
        {
            if (optional) return null;
            throw new InvalidOperationException(
                "no control in " + Describe(window) + " is named like \"" + needle + "\"");
        }
        List<Node> exact = new List<Node>();
        for (int index = 0; index < matches.Count; index++)
        {
            if (string.Equals(matches[index].Name, needle, StringComparison.OrdinalIgnoreCase)) exact.Add(matches[index]);
        }
        List<Node> shortlist = exact.Count > 0 ? exact : matches;
        List<Node> enabled = new List<Node>();
        for (int index = 0; index < shortlist.Count; index++)
        {
            if (shortlist[index].Enabled) enabled.Add(shortlist[index]);
        }
        if (enabled.Count > 0) shortlist = enabled;
        if (shortlist.Count > 1)
        {
            StringBuilder text = new StringBuilder();
            text.Append(shortlist.Count + " controls match \"" + needle + "\", so no control was selected:");
            for (int index = 0; index < shortlist.Count && index < 6; index++)
            {
                text.Append("\n  " + shortlist[index].Line().TrimStart());
            }
            text.Append("\nName one of them exactly, or click the coordinates.");
            throw new InvalidOperationException(text.ToString());
        }
        return shortlist[0];
    }

    public static void EnsureVisibleAt(AutomationElement window, int x, int y)
    {
        IntPtr target = Handle(window);
        if (target == IntPtr.Zero) throw new InvalidOperationException("the target window disappeared; read it again before clicking");
        POINT point = new POINT();
        point.X = x;
        point.Y = y;
        IntPtr hit = Native.GetAncestor(Native.WindowFromPoint(point), Native.GA_ROOT);
        if (hit == target) return;
        throw new InvalidOperationException(
            "the control at " + x + "," + y + " is covered by another window - focus the target first");
    }

    private static IntPtr Handle(AutomationElement window)
    {
        try
        {
            object value = window.GetCurrentPropertyValue(AutomationElement.NativeWindowHandleProperty);
            if (value == null) return IntPtr.Zero;
            return new IntPtr(Convert.ToInt64(value));
        }
        catch
        {
            return IntPtr.Zero;
        }
    }

    private static List<Node> Matches(AutomationElement window, string needle)
    {
        string wanted = needle.ToLowerInvariant();
        List<Node> nodes = Collect(window, SearchDepth, false, NodeCap * 4 + 1);
        if (nodes.Count > NodeCap * 4)
            throw new InvalidOperationException("the window has too many controls to confirm a unique match; use a fresh tree and coordinates");
        List<Node> matches = new List<Node>();
        for (int index = 0; index < nodes.Count; index++)
        {
            Node node = nodes[index];
            if (node.Name.ToLowerInvariant().Contains(wanted) || node.Id.ToLowerInvariant().Contains(wanted))
            {
                matches.Add(node);
            }
        }
        return matches;
    }

    private static List<Node> Collect(AutomationElement window, int maxDepth, bool all, int cap)
    {
        Warmup(window);
        List<Node> nodes = new List<Node>();
        CacheRequest request = new CacheRequest();
        request.Add(AutomationElement.NameProperty);
        request.Add(AutomationElement.AutomationIdProperty);
        request.Add(AutomationElement.ControlTypeProperty);
        request.Add(AutomationElement.BoundingRectangleProperty);
        request.Add(AutomationElement.IsEnabledProperty);
        request.Add(AutomationElement.IsOffscreenProperty);
        using (request.Activate())
        {
            Walk(window, 0, maxDepth, all, cap, nodes);
        }
        return nodes;
    }

    private static void Walk(AutomationElement element, int depth, int maxDepth, bool all, int cap, List<Node> nodes)
    {
        if (nodes.Count >= cap || depth > maxDepth) return;
        AutomationElementCollection children;
        try
        {
            children = element.FindAll(TreeScope.Children, Condition.TrueCondition);
        }
        catch
        {
            return;
        }
        for (int index = 0; index < children.Count && nodes.Count < cap; index++)
        {
            Node node = Read(children[index], depth);
            if (node != null && (all || node.Worth())) nodes.Add(node);
            Walk(children[index], depth + 1, maxDepth, all, cap, nodes);
        }
    }

    private static Node Read(AutomationElement element, int depth)
    {
        try
        {
            System.Windows.Rect bounds =
                (System.Windows.Rect)element.GetCachedPropertyValue(AutomationElement.BoundingRectangleProperty);
            if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0) return null;
            if ((bool)element.GetCachedPropertyValue(AutomationElement.IsOffscreenProperty)) return null;
            Node node = new Node();
            node.Element = element;
            node.Depth = depth;
            node.Name = Text(element.GetCachedPropertyValue(AutomationElement.NameProperty));
            node.Id = Text(element.GetCachedPropertyValue(AutomationElement.AutomationIdProperty));
            node.Role = Role(element);
            node.Left = (int)Math.Round(bounds.Left);
            node.Top = (int)Math.Round(bounds.Top);
            node.Width = (int)Math.Round(bounds.Width);
            node.Height = (int)Math.Round(bounds.Height);
            node.Enabled = (bool)element.GetCachedPropertyValue(AutomationElement.IsEnabledProperty);
            return node;
        }
        catch
        {
            return null;
        }
    }

    private static void Warmup(AutomationElement window)
    {
        try
        {
            if (!WakeRenderers(window)) return;
            for (int attempt = 0; attempt < WarmupAttempts; attempt++)
            {
                if (Populated(window)) return;
                System.Threading.Thread.Sleep(WarmupMs);
            }
        }
        catch
        {
        }
    }

    private static bool WakeRenderers(AutomationElement window)
    {
        IntPtr host = Handle(window);
        if (host == IntPtr.Zero) return false;
        bool found = false;
        Native.EnumChildWindows(host, delegate(IntPtr child, IntPtr unused)
        {
            if (!IsRenderer(child)) return true;
            found = true;
            IntPtr answer;
            Native.SendMessageTimeout(
                child,
                Native.WM_GETOBJECT,
                IntPtr.Zero,
                new IntPtr(Native.OBJID_CLIENT),
                Native.SMTO_ABORTIFHUNG,
                200,
                out answer);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static bool IsRenderer(IntPtr handle)
    {
        StringBuilder name = new StringBuilder(96);
        Native.GetClassName(handle, name, name.Capacity);
        return name.ToString() == "Chrome_RenderWidgetHostHWND";
    }

    private static AutomationElement Document(AutomationElement window)
    {
        try
        {
            return window.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
        }
        catch
        {
            return null;
        }
    }

    private static bool Populated(AutomationElement window)
    {
        AutomationElement document = Document(window);
        if (document == null) return false;
        try
        {
            return document.FindFirst(TreeScope.Children, Condition.TrueCondition) != null;
        }
        catch
        {
            return false;
        }
    }

    private static string Role(AutomationElement element)
    {
        try
        {
            ControlType type = (ControlType)element.GetCachedPropertyValue(AutomationElement.ControlTypeProperty);
            string programmatic = type.ProgrammaticName;
            int dot = programmatic.IndexOf('.');
            return dot >= 0 ? programmatic.Substring(dot + 1) : programmatic;
        }
        catch
        {
            return "Element";
        }
    }

    private static string Safe(AutomationElement element, bool cached)
    {
        try
        {
            return Text(cached ? element.GetCachedPropertyValue(AutomationElement.NameProperty) : element.Current.Name);
        }
        catch
        {
            return "";
        }
    }

    private static string Text(object value)
    {
        if (value == null) return "";
        return value.ToString().Replace('\r', ' ').Replace('\n', ' ').Trim();
    }

    private static string Json(List<Node> nodes)
    {
        StringBuilder text = new StringBuilder();
        text.Append('[');
        for (int index = 0; index < nodes.Count; index++)
        {
            if (index > 0) text.Append(',');
            text.Append(nodes[index].Json());
        }
        text.Append(']');
        return text.ToString();
    }

    public sealed class Node
    {
        public AutomationElement Element;
        public int Depth;
        public string Role;
        public string Name;
        public string Id;
        public int Left;
        public int Top;
        public int Width;
        public int Height;
        public bool Enabled;

        public int CenterX
        {
            get { return Left + Width / 2; }
        }

        public int CenterY
        {
            get { return Top + Height / 2; }
        }

        public bool Worth()
        {
            return Name.Length > 0 || Id.Length > 0;
        }

        public string Label()
        {
            if (Name.Length > 0) return Name;
            return Id.Length > 0 ? Id : Role;
        }

        public string Line()
        {
            StringBuilder text = new StringBuilder();
            text.Append(new string(' ', Math.Min(Depth, 12) * 2));
            text.Append(Role);
            if (Name.Length > 0) text.Append(" \"" + Shorten(Name, 70) + "\"");
            else if (Id.Length > 0) text.Append(" #" + Shorten(Id, 40));
            text.Append(" @" + CenterX + "," + CenterY);
            if (!Enabled) text.Append(" disabled");
            return text.ToString();
        }

        public string Json()
        {
            StringBuilder text = new StringBuilder();
            text.Append("{\"depth\":" + Depth);
            text.Append(",\"role\":" + Quote(Role));
            text.Append(",\"name\":" + Quote(Name));
            text.Append(",\"id\":" + Quote(Id));
            text.Append(",\"left\":" + Left + ",\"top\":" + Top);
            text.Append(",\"width\":" + Width + ",\"height\":" + Height);
            text.Append(",\"x\":" + CenterX + ",\"y\":" + CenterY);
            text.Append(",\"enabled\":" + (Enabled ? "true" : "false"));
            text.Append('}');
            return text.ToString();
        }

        private static string Shorten(string value, int limit)
        {
            if (value.Length <= limit) return value;
            return value.Substring(0, limit - 1) + (char)0x2026;
        }

        private static string Quote(string value)
        {
            StringBuilder text = new StringBuilder("\"");
            for (int index = 0; index < value.Length; index++)
            {
                char character = value[index];
                if (character == '"' || character == '\\') text.Append('\\').Append(character);
                else if (character < ' ') text.Append(' ');
                else text.Append(character);
            }
            return text.Append('"').ToString();
        }
    }
}
}
