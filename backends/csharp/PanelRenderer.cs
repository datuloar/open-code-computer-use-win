namespace OpenCodeCu
{

public sealed class PanelRenderer : IDisposable
{
    private const double PillHeight = 44;
    private const double PadSide = 20;
    private const double DotZone = 26;
    private const double GapText = 10;
    private const double GapAction = 14;
    private const double GapDivider = 16;
    private const double GapChip = 9;
    private const double ChipWidth = 40;
    private const double ChipHeight = 21;
    private const double ShadowRoom = 34;
    private const int ShadowLayers = 7;
    private const int ActionChars = 46;
    private const char Ellipsis = (char)0x2026;

    private readonly Font _title;
    private readonly Font _action;
    private readonly Font _chip;
    private readonly Font _hint;
    private readonly StringFormat _format;
    private readonly Bitmap _canvas;

    public PanelRenderer(int canvasWidth)
    {
        _title = Theme.Strong(10.5);
        _action = Theme.Ui(9.5, FontStyle.Regular);
        _chip = Theme.Strong(8.5);
        _hint = Theme.Ui(9.5, FontStyle.Regular);
        _format = new StringFormat(StringFormat.GenericTypographic);
        _format.FormatFlags |= StringFormatFlags.NoWrap;
        _format.Trimming = StringTrimming.None;
        _canvas = Theme.Canvas(canvasWidth, CanvasHeight());
    }

    public static int CanvasHeight()
    {
        return Theme.Px(PillHeight + ShadowRoom);
    }

    public static string Title(PanelState state)
    {
        if (!state.Announcing) return Theme.AppName + " is controlling your computer";
        return Theme.AppName + " takes control in " + Math.Max(1, state.SecondsLeft) + "s";
    }

    public static string Hint(PanelState state)
    {
        return state.Announcing ? "to cancel" : "to stop";
    }

    public static string Shorten(string text, int limit)
    {
        if (string.IsNullOrEmpty(text)) return "";
        string single = text.Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (single.Length <= limit) return single;
        return single.Substring(0, Math.Max(1, limit - 1)).TrimEnd() + Ellipsis;
    }

    public void Draw(LayeredWindow window, PanelState state)
    {
        using (Graphics graphics = Theme.Surface(_canvas))
        {
            Layout layout = Measure(graphics, state);
            RectangleF pill = new RectangleF(
                (_canvas.Width - layout.Width) / 2f,
                Theme.Pxf(12),
                layout.Width,
                Theme.Pxf(PillHeight));
            DrawShadow(graphics, pill);
            DrawBody(graphics, pill, state);
            DrawContent(graphics, pill, state, layout);
        }
        window.Present(_canvas, 255);
    }

    private Layout Measure(Graphics graphics, PanelState state)
    {
        Layout layout = new Layout();
        layout.Title = Title(state);
        layout.Hint = Hint(state);
        layout.Action = state.ActionOpacity > 0.02 ? Shorten(state.Action, ActionChars) : "";
        layout.TitleWidth = graphics.MeasureString(layout.Title, _title, int.MaxValue, _format).Width;
        layout.HintWidth = graphics.MeasureString(layout.Hint, _hint, int.MaxValue, _format).Width;
        layout.ActionWidth = layout.Action.Length == 0
            ? 0
            : graphics.MeasureString(layout.Action, _action, int.MaxValue, _format).Width;
        float ceiling = _canvas.Width - Theme.Pxf(16);
        float fixedWidth = Theme.Pxf(PadSide * 2 + DotZone + GapText + GapDivider * 2 + 1 + ChipWidth + GapChip)
            + layout.HintWidth;
        if (layout.TitleWidth > ceiling - fixedWidth)
        {
            layout.Title = Theme.AppName + (state.Announcing ? " " + Math.Max(1, state.SecondsLeft) + "s" : " on");
        }
        layout.Title = Fit(graphics, layout.Title, _title, Math.Max(0, ceiling - fixedWidth));
        layout.TitleWidth = graphics.MeasureString(layout.Title, _title, int.MaxValue, _format).Width;
        layout.Action = Fit(graphics, layout.Action, _action,
            Math.Max(0, ceiling - fixedWidth - layout.TitleWidth - Theme.Pxf(GapAction)));
        layout.ActionWidth = layout.Action.Length == 0 ? 0 : graphics.MeasureString(layout.Action, _action, int.MaxValue, _format).Width;
        layout.Width = Theme.Pxf(PadSide + DotZone + GapText)
            + layout.TitleWidth
            + (layout.Action.Length == 0 ? 0 : Theme.Pxf(GapAction) + layout.ActionWidth)
            + Theme.Pxf(GapDivider * 2 + 1 + ChipWidth + GapChip)
            + layout.HintWidth
            + Theme.Pxf(PadSide);
        if (layout.Width > ceiling) layout.Width = ceiling;
        return layout;
    }

    private string Fit(Graphics graphics, string text, Font font, float width)
    {
        if (graphics.MeasureString(text, font, int.MaxValue, _format).Width <= width) return text;
        if (graphics.MeasureString(Ellipsis.ToString(), font, int.MaxValue, _format).Width > width) return "";
        int length = text.Length;
        while (length > 0)
        {
            string shortened = text.Substring(0, --length).TrimEnd() + Ellipsis;
            if (graphics.MeasureString(shortened, font, int.MaxValue, _format).Width <= width) return shortened;
        }
        return "";
    }

    private void DrawShadow(Graphics graphics, RectangleF pill)
    {
        for (int layer = ShadowLayers; layer >= 1; layer--)
        {
            float spread = Theme.Pxf(layer * 1.6);
            RectangleF bounds = RectangleF.Inflate(pill, spread, spread);
            bounds.Y += Theme.Pxf(1.6);
            int alpha = (int)Math.Round(15.0 * (1.0 - (double)layer / (ShadowLayers + 1)));
            if (alpha <= 0) continue;
            using (GraphicsPath path = Theme.Pill(bounds, Theme.Pxf(Theme.PanelRadius) + spread))
            using (SolidBrush brush = new SolidBrush(Theme.Alpha(Theme.Shadow, alpha)))
            {
                graphics.FillPath(brush, path);
            }
        }
    }

    private void DrawBody(Graphics graphics, RectangleF pill, PanelState state)
    {
        using (GraphicsPath path = Theme.Pill(pill, Theme.Pxf(Theme.PanelRadius)))
        {
            using (LinearGradientBrush fill = new LinearGradientBrush(
                new RectangleF(pill.X, pill.Y - 1, pill.Width, pill.Height + 2),
                Theme.Alpha(Theme.PanelTop, Theme.PanelAlpha),
                Theme.Alpha(Theme.PanelBottom, Theme.PanelAlpha),
                LinearGradientMode.Vertical))
            {
                graphics.FillPath(fill, path);
            }

            Color edge = state.Announcing ? Theme.Alpha(Theme.Warn, 104) : Theme.Hairline;
            using (Pen border = new Pen(edge, Theme.Pxf(1.1)))
            {
                graphics.DrawPath(border, path);
            }

            Region previous = graphics.Clip;
            graphics.SetClip(path);
            using (LinearGradientBrush sheen = new LinearGradientBrush(
                new RectangleF(pill.X, pill.Y, pill.Width, Theme.Pxf(2)),
                Color.Transparent,
                Color.Transparent,
                LinearGradientMode.Horizontal))
            {
                ColorBlend blend = new ColorBlend();
                blend.Positions = new float[] { 0f, 0.5f, 1f };
                blend.Colors = new Color[]
                {
                    Color.FromArgb(0, 255, 255, 255),
                    Color.FromArgb(46, 255, 255, 255),
                    Color.FromArgb(0, 255, 255, 255),
                };
                sheen.InterpolationColors = blend;
                graphics.FillRectangle(sheen, pill.X, pill.Y + Theme.Pxf(1), pill.Width, Theme.Pxf(1));
            }
            graphics.Clip = previous;
        }
    }

    private void DrawContent(Graphics graphics, RectangleF pill, PanelState state, Layout layout)
    {
        float middle = pill.Y + pill.Height / 2f;
        float cursor = pill.X + Theme.Pxf(PadSide);
        DrawStatusDot(graphics, new PointF(cursor + Theme.Pxf(DotZone) / 2f, middle), state);
        cursor += Theme.Pxf(DotZone + GapText);

        Color title = state.Announcing ? Theme.Alpha(Theme.Warn, 246) : Theme.Ink;
        using (SolidBrush brush = new SolidBrush(title))
        {
            DrawMiddle(graphics, layout.Title, _title, brush, cursor, middle);
        }
        cursor += layout.TitleWidth;

        if (layout.Action.Length > 0)
        {
            cursor += Theme.Pxf(GapAction);
            using (SolidBrush brush = new SolidBrush(Theme.Fade(Theme.InkDim, state.ActionOpacity)))
            {
                DrawMiddle(graphics, layout.Action, _action, brush, cursor, middle);
            }
        }

        float hintLeft = pill.Right - Theme.Pxf(PadSide) - layout.HintWidth;
        using (SolidBrush brush = new SolidBrush(Theme.InkDim))
        {
            DrawMiddle(graphics, layout.Hint, _hint, brush, hintLeft, middle);
        }

        float chipLeft = hintLeft - Theme.Pxf(GapChip + ChipWidth);
        DrawChip(
            graphics,
            new RectangleF(
                chipLeft,
                middle - Theme.Pxf(ChipHeight) / 2f,
                Theme.Pxf(ChipWidth),
                Theme.Pxf(ChipHeight)));

        float dividerX = chipLeft - Theme.Pxf(GapDivider);
        using (Pen divider = new Pen(Color.FromArgb(34, 255, 255, 255), Theme.Pxf(1)))
        {
            graphics.DrawLine(divider, dividerX, middle - Theme.Pxf(9), dividerX, middle + Theme.Pxf(9));
        }
    }

    private void DrawStatusDot(Graphics graphics, PointF center, PanelState state)
    {
        Color accent = state.Announcing ? Theme.Warn : Theme.Accent;
        if (!state.Announcing)
        {
            float side = Theme.Pxf(7);
            using (SolidBrush square = new SolidBrush(accent))
            {
                graphics.FillRectangle(square, center.X - side / 2, center.Y - side / 2, side, side);
            }
            return;
        }
        float halo = Theme.Pxf(state.Announcing ? 12 : 10 + 3 * state.Pulse);
        using (GraphicsPath glow = new GraphicsPath())
        {
            glow.AddEllipse(center.X - halo, center.Y - halo, halo * 2, halo * 2);
            using (PathGradientBrush brush = new PathGradientBrush(glow))
            {
                brush.CenterPoint = center;
                brush.CenterColor = Theme.Alpha(accent, (int)(70 + 70 * state.Pulse));
                brush.SurroundColors = new Color[] { Color.FromArgb(0, accent) };
                graphics.FillPath(brush, glow);
            }
        }

        if (state.Announcing)
        {
            float ring = Theme.Pxf(9);
            using (Pen track = new Pen(Theme.Alpha(accent, 54), Theme.Pxf(2)))
            {
                graphics.DrawEllipse(track, center.X - ring, center.Y - ring, ring * 2, ring * 2);
            }
            float sweep = (float)(360 * Theme.Clamp(state.Remaining, 0, 1));
            if (sweep > 0.5f)
            {
                using (Pen arc = new Pen(Theme.Alpha(accent, 236), Theme.Pxf(2)))
                {
                    arc.StartCap = LineCap.Round;
                    arc.EndCap = LineCap.Round;
                    graphics.DrawArc(arc, center.X - ring, center.Y - ring, ring * 2, ring * 2, -90, -sweep);
                }
            }
        }

        float radius = Theme.Pxf(state.Announcing ? 3.4 : 4.2);
        using (SolidBrush core = new SolidBrush(Theme.Alpha(accent, 255)))
        {
            graphics.FillEllipse(core, center.X - radius, center.Y - radius, radius * 2, radius * 2);
        }
    }

    private void DrawChip(Graphics graphics, RectangleF bounds)
    {
        using (GraphicsPath path = Theme.Pill(bounds, Theme.Pxf(6)))
        {
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(20, 255, 255, 255)))
            {
                graphics.FillPath(fill, path);
            }
            using (Pen border = new Pen(Color.FromArgb(72, 255, 255, 255), Theme.Pxf(1)))
            {
                graphics.DrawPath(border, path);
            }
        }
        SizeF size = graphics.MeasureString("ESC", _chip, int.MaxValue, _format);
        using (SolidBrush brush = new SolidBrush(Theme.Alpha(Theme.Ink, 228)))
        {
            graphics.DrawString(
                "ESC",
                _chip,
                brush,
                bounds.X + (bounds.Width - size.Width) / 2f,
                bounds.Y + (bounds.Height - size.Height) / 2f,
                _format);
        }
    }

    private void DrawMiddle(Graphics graphics, string text, Font font, Brush brush, float left, float middle)
    {
        SizeF size = graphics.MeasureString(text, font, int.MaxValue, _format);
        graphics.DrawString(text, font, brush, left, middle - size.Height / 2f, _format);
    }

    public void Dispose()
    {
        _title.Dispose();
        _action.Dispose();
        _chip.Dispose();
        _hint.Dispose();
        _format.Dispose();
        _canvas.Dispose();
    }

    private sealed class Layout
    {
        public string Title;
        public string Hint;
        public string Action;
        public float TitleWidth;
        public float HintWidth;
        public float ActionWidth;
        public float Width;
    }
}
}
