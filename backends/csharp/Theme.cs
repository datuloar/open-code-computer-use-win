namespace DshCu
{

public static class Theme
{
    public const int TickMs = 30;

    public static readonly bool OpenCode = string.Equals(
        Environment.GetEnvironmentVariable("DSH_CU_THEME"), "opencode", StringComparison.OrdinalIgnoreCase);
    public static readonly string AppName = OpenCode ? "OpenCode" : "DeepSeek";
    public static readonly int PanelAlpha = OpenCode ? 255 : 238;
    public static readonly double PanelRadius = OpenCode ? 6 : 22;
    public static readonly Color Ink = OpenCode ? Color.FromArgb(238, 238, 238) : Color.FromArgb(236, 240, 250);
    public static readonly Color InkDim = OpenCode ? Color.FromArgb(170, 170, 170) : Color.FromArgb(150, 159, 182);
    public static readonly Color Accent = OpenCode ? Color.FromArgb(250, 178, 131) : Color.FromArgb(96, 126, 255);
    public static readonly Color Warn = OpenCode ? Color.FromArgb(245, 167, 66) : Color.FromArgb(255, 176, 72);
    public static readonly Color PanelTop = OpenCode ? Color.FromArgb(20, 20, 20) : Color.FromArgb(33, 36, 48);
    public static readonly Color PanelBottom = OpenCode ? PanelTop : Color.FromArgb(17, 19, 27);
    public static readonly Color FrameCore = OpenCode ? Accent : Color.FromArgb(188, 208, 255);
    public static readonly Color Hairline = OpenCode ? Color.FromArgb(72, 72, 72) : Color.FromArgb(52, 255, 255, 255);
    public static readonly Color Shadow = Color.FromArgb(0, 0, 0);

    private static readonly string[] Preferred = OpenCode ? new string[] { "Cascadia Mono", "Consolas" } : new string[]
    {
        "Segoe UI Variable Text",
        "Segoe UI",
        "Tahoma",
        "Arial",
    };

    private static readonly string[] PreferredStrong = OpenCode ? new string[0] : new string[]
    {
        "Segoe UI Semibold",
        "Segoe UI Variable Text Semibold",
    };

    private static readonly float ScaleFactor;
    private static readonly string Family;
    private static readonly string StrongFamily;

    static Theme()
    {
        float dpi = Native.SystemDpi();
        float scale = (dpi <= 0 ? 1f : dpi / 96f) * RequestedScale();
        if (scale < 0.75f) scale = 0.75f;
        if (scale > 4f) scale = 4f;
        ScaleFactor = scale;
        Family = PickFamily(Preferred, null);
        StrongFamily = PickFamily(PreferredStrong, "");
    }

    private static float RequestedScale()
    {
        try
        {
            string raw = Environment.GetEnvironmentVariable("DSH_CU_UI_SCALE");
            if (string.IsNullOrEmpty(raw)) return 1f;
            float parsed;
            if (float.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed) && parsed > 0)
            {
                return parsed;
            }
        }
        catch
        {
        }
        return 1f;
    }

    public static int Px(double dip)
    {
        return (int)Math.Round(dip * ScaleFactor);
    }

    public static float Pxf(double dip)
    {
        return (float)(dip * ScaleFactor);
    }

    public static Font Ui(double points, FontStyle style)
    {
        return new Font(Family, (float)(points * ScaleFactor), style, GraphicsUnit.Point);
    }

    public static Font Strong(double points)
    {
        if (StrongFamily.Length == 0) return Ui(points, FontStyle.Bold);
        return new Font(StrongFamily, (float)(points * ScaleFactor), FontStyle.Regular, GraphicsUnit.Point);
    }

    public static Bitmap Canvas(int width, int height)
    {
        Bitmap bitmap = new Bitmap(Math.Max(1, width), Math.Max(1, height), PixelFormat.Format32bppPArgb);
        bitmap.SetResolution(96f, 96f);
        return bitmap;
    }

    public static Graphics Surface(Bitmap bitmap)
    {
        Graphics graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.CompositingQuality = CompositingQuality.HighQuality;
        graphics.Clear(Color.Transparent);
        return graphics;
    }

    public static Color Fade(Color color, double amount)
    {
        int alpha = (int)Math.Round(color.A * Clamp(amount, 0, 1));
        return Color.FromArgb(Math.Max(0, Math.Min(255, alpha)), color.R, color.G, color.B);
    }

    public static Color Alpha(Color color, int alpha)
    {
        return Color.FromArgb(Math.Max(0, Math.Min(255, alpha)), color.R, color.G, color.B);
    }

    public static double Clamp(double value, double low, double high)
    {
        if (value < low) return low;
        if (value > high) return high;
        return value;
    }

    public static double Smooth(double t)
    {
        double clamped = Clamp(t, 0, 1);
        return clamped * clamped * (3 - 2 * clamped);
    }

    public static GraphicsPath Pill(RectangleF bounds, float radius)
    {
        float limit = Math.Min(bounds.Width, bounds.Height) / 2f;
        float corner = Math.Min(radius, limit);
        float diameter = corner * 2f;
        GraphicsPath path = new GraphicsPath();
        if (diameter <= 0)
        {
            path.AddRectangle(bounds);
            return path;
        }
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static string PickFamily(string[] wanted, string fallback)
    {
        FontFamily[] installed = FontFamily.Families;
        for (int index = 0; index < wanted.Length; index++)
        {
            for (int family = 0; family < installed.Length; family++)
            {
                if (string.Equals(installed[family].Name, wanted[index], StringComparison.OrdinalIgnoreCase))
                {
                    return wanted[index];
                }
            }
        }
        return fallback ?? FontFamily.GenericSansSerif.Name;
    }
}
}
