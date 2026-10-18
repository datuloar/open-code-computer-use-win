namespace DshCu
{

public sealed class PointerRenderer : IDisposable
{
    public static readonly int Size = Theme.Px(260);

    private const int MaxTrail = 14;
    private const int TrailFadeAfterTicks = 5;
    private const float GlideFactor = 0.34f;
    private const double ArrowScale = 1.85;
    private const double RippleSeconds = 0.62;
    private const double RingRadius = 15;
    private const double RingBreathSeconds = 2.2;
    private const double FlashSeconds = 0.26;

    private readonly List<PointF> _trail = new List<PointF>();
    private readonly List<Ripple> _ripples = new List<Ripple>();
    private readonly Bitmap _canvas;
    private readonly bool _arrow;

    private PointF _glide;
    private Point _cursor;
    private double _breath;
    private int _idleTicks;
    private double _flash;
    private bool _leftWasDown;
    private bool _rightWasDown;

    public PointerRenderer(Point cursor, bool arrow)
    {
        _cursor = cursor;
        _arrow = arrow;
        _glide = new PointF(cursor.X, cursor.Y);
        _canvas = Theme.Canvas(Size, Size);
    }

    public void Track(Point cursor, bool leftDown, bool rightDown)
    {
        bool moved = Math.Abs(cursor.X - _cursor.X) + Math.Abs(cursor.Y - _cursor.Y) > 1;
        bool jumped = Math.Abs(cursor.X - _cursor.X) + Math.Abs(cursor.Y - _cursor.Y) > Size / 3;
        _cursor = cursor;
        _breath += Theme.TickMs / 1000.0;
        if (jumped) _trail.Clear();
        _glide = new PointF(
            _glide.X + (cursor.X - _glide.X) * GlideFactor,
            _glide.Y + (cursor.Y - _glide.Y) * GlideFactor);

        UpdateTrail(moved);
        UpdateClicks(leftDown, rightDown);
    }

    public void Draw(LayeredWindow window)
    {
        window.Location = new Point(_cursor.X - Size / 2, _cursor.Y - Size / 2);
        using (Graphics graphics = Theme.Surface(_canvas))
        {
            PointF center = new PointF(Size / 2f, Size / 2f);
            DrawTrail(graphics, center);
            DrawRipples(graphics, center);
            if (_arrow) DrawArrow(graphics, center);
            else DrawRing(graphics, center);
        }
        window.Present(_canvas, 255);
    }

    private void UpdateTrail(bool moved)
    {
        if (moved)
        {
            _idleTicks = 0;
            _trail.Insert(0, _glide);
            if (_trail.Count > MaxTrail) _trail.RemoveAt(_trail.Count - 1);
            return;
        }
        if (++_idleTicks > TrailFadeAfterTicks && _trail.Count > 0) _trail.RemoveAt(_trail.Count - 1);
    }

    private void UpdateClicks(bool leftDown, bool rightDown)
    {
        if (leftDown && !_leftWasDown) AddRipple(false);
        if (rightDown && !_rightWasDown) AddRipple(true);
        _leftWasDown = leftDown;
        _rightWasDown = rightDown;

        _flash = Math.Max(0, _flash - Theme.TickMs / (FlashSeconds * 1000));
        for (int index = _ripples.Count - 1; index >= 0; index--)
        {
            _ripples[index].Age += Theme.TickMs / (RippleSeconds * 1000);
            if (_ripples[index].Age > 1) _ripples.RemoveAt(index);
        }
    }

    private void AddRipple(bool rightClick)
    {
        Ripple ripple = new Ripple();
        ripple.RightClick = rightClick;
        _ripples.Add(ripple);
        _flash = 1;
        _glide = new PointF(_cursor.X, _cursor.Y);
        _trail.Clear();
    }

    private void DrawTrail(Graphics graphics, PointF center)
    {
        for (int index = 1; index < _trail.Count; index++)
        {
            PointF history = _trail[index];
            PointF local = new PointF(
                center.X + (history.X - _cursor.X),
                center.Y + (history.Y - _cursor.Y));
            double progress = 1.0 - (double)index / _trail.Count;
            int alpha = (int)(78 * progress * progress);
            if (alpha <= 2) continue;
            float radius = Theme.Pxf(1.4 + 2.4 * progress);
            using (SolidBrush dot = new SolidBrush(Theme.Alpha(Theme.Accent, alpha)))
            {
                graphics.FillEllipse(dot, local.X - radius, local.Y - radius, radius * 2, radius * 2);
            }
        }
    }

    private void DrawRipples(Graphics graphics, PointF center)
    {
        for (int index = 0; index < _ripples.Count; index++)
        {
            Color accent = _ripples[index].RightClick ? Theme.Warn : Theme.Accent;
            double age = _ripples[index].Age;
            for (int ring = 0; ring < 2; ring++)
            {
                double staged = age - ring * 0.18;
                if (staged <= 0) continue;
                float radius = Theme.Pxf(11 + 46 * staged);
                int alpha = (int)(170 * (1 - staged) * (1 - ring * 0.45));
                if (alpha <= 2) continue;
                using (Pen pen = new Pen(Theme.Alpha(accent, alpha), Theme.Pxf(2.4 - ring * 0.9)))
                {
                    graphics.DrawEllipse(pen, center.X - radius, center.Y - radius, radius * 2, radius * 2);
                }
            }
            if (age < 0.5)
            {
                float radius = Theme.Pxf(9);
                using (SolidBrush brush = new SolidBrush(Theme.Alpha(accent, (int)(70 * (1 - age * 2)))))
                {
                    graphics.FillEllipse(brush, center.X - radius, center.Y - radius, radius * 2, radius * 2);
                }
            }
        }
    }

    private void DrawRing(Graphics graphics, PointF hotspot)
    {
        PointF center = new PointF(hotspot.X + Theme.Pxf(5), hotspot.Y + Theme.Pxf(5));
        double breathe = Theme.OpenCode ? 0.5 : 0.5 + 0.5 * Math.Sin(_breath * (2 * Math.PI / RingBreathSeconds));
        float radius = Theme.Pxf(RingRadius + 1.2 * breathe + 3.0 * _flash);
        int core = (int)(120 + 40 * breathe + 90 * _flash);

        using (Pen halo = new Pen(Theme.Alpha(Theme.Accent, (int)(34 + 30 * _flash)), Theme.Pxf(6.5)))
        {
            graphics.DrawEllipse(halo, center.X - radius, center.Y - radius, radius * 2, radius * 2);
        }
        using (Pen shadow = new Pen(Color.FromArgb(90, 8, 11, 20), Theme.Pxf(3.4)))
        {
            graphics.DrawEllipse(shadow, center.X - radius, center.Y - radius, radius * 2, radius * 2);
        }
        using (Pen ring = new Pen(Theme.Alpha(Theme.Accent, Math.Min(235, core)), Theme.Pxf(2.1)))
        {
            graphics.DrawEllipse(ring, center.X - radius, center.Y - radius, radius * 2, radius * 2);
        }
        float inner = radius - Theme.Pxf(3.2);
        using (Pen sheen = new Pen(Color.FromArgb((int)(52 + 60 * _flash), 255, 255, 255), Theme.Pxf(1)))
        {
            graphics.DrawEllipse(sheen, center.X - inner, center.Y - inner, inner * 2, inner * 2);
        }
    }

    private void DrawArrow(Graphics graphics, PointF tip)
    {
        bool flashing = _flash > 0.05;
        Color accent = Theme.Accent;
        using (GraphicsPath arrow = ArrowPath(tip))
        {
            float halo = Theme.Pxf(26);
            using (GraphicsPath ring = new GraphicsPath())
            {
                ring.AddEllipse(tip.X - halo, tip.Y - halo, halo * 2, halo * 2);
                using (PathGradientBrush brush = new PathGradientBrush(ring))
                {
                    brush.CenterPoint = tip;
                    brush.CenterColor = Theme.Alpha(accent, (int)(46 + 74 * _flash));
                    brush.SurroundColors = new Color[] { Color.FromArgb(0, accent) };
                    graphics.FillPath(brush, ring);
                }
            }

            using (Pen shadow = new Pen(Color.FromArgb(120, 8, 11, 20), Theme.Pxf(3.6)))
            {
                shadow.LineJoin = LineJoin.Round;
                graphics.DrawPath(shadow, arrow);
            }
            using (LinearGradientBrush body = new LinearGradientBrush(
                arrow.GetBounds(),
                Color.FromArgb(252, 255, 255, 255),
                Color.FromArgb(252, 214, 224, 255),
                LinearGradientMode.ForwardDiagonal))
            {
                graphics.FillPath(body, arrow);
            }
            using (Pen edge = new Pen(Theme.Alpha(flashing ? accent : Color.FromArgb(28, 34, 54), 214), Theme.Pxf(1.3)))
            {
                edge.LineJoin = LineJoin.Round;
                graphics.DrawPath(edge, arrow);
            }
        }
    }

    private static GraphicsPath ArrowPath(PointF tip)
    {
        float[] unit = new float[]
        {
            0f, 0f,
            0f, 17f,
            4.2f, 13.2f,
            6.9f, 19.4f,
            9.6f, 18.2f,
            6.9f, 12.2f,
            11.6f, 12.0f,
        };
        float scale = Theme.Pxf(ArrowScale);
        PointF[] points = new PointF[unit.Length / 2];
        for (int index = 0; index < points.Length; index++)
        {
            points[index] = new PointF(tip.X + unit[index * 2] * scale, tip.Y + unit[index * 2 + 1] * scale);
        }
        GraphicsPath path = new GraphicsPath();
        path.AddPolygon(points);
        return path;
    }

    public void Dispose()
    {
        _canvas.Dispose();
    }

    private sealed class Ripple
    {
        public double Age;
        public bool RightClick;
    }
}
}
