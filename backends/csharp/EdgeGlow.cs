namespace DshCu
{

public sealed class EdgeGlow : IDisposable
{
    private readonly LayeredWindow[] _windows;
    private readonly Bitmap[] _strips;
    private int _shownAlpha;

    public EdgeGlow(Rectangle screen)
    {
        Rectangle[] bounds = Strips(screen);
        _windows = new LayeredWindow[bounds.Length];
        _strips = new Bitmap[bounds.Length];
        for (int index = 0; index < bounds.Length; index++)
        {
            _strips[index] = FrameRenderer.Strip(bounds[index], screen);
            _windows[index] = new LayeredWindow(bounds[index]);
        }
        _shownAlpha = -1;
    }

    public void Show()
    {
        for (int index = 0; index < _windows.Length; index++) _windows[index].Show();
    }

    public void Present(int constantAlpha)
    {
        if (constantAlpha == _shownAlpha) return;
        _shownAlpha = constantAlpha;
        for (int index = 0; index < _windows.Length; index++)
        {
            _windows[index].Present(_strips[index], constantAlpha);
        }
    }

    private static Rectangle[] Strips(Rectangle screen)
    {
        int depth = Math.Min(FrameRenderer.Depth(), Math.Max(1, Math.Min(screen.Width, screen.Height) / 3));
        int sides = screen.Height - depth * 2;
        if (sides <= 0) return new Rectangle[] { screen };
        return new Rectangle[]
        {
            new Rectangle(screen.X, screen.Y, screen.Width, depth),
            new Rectangle(screen.X, screen.Bottom - depth, screen.Width, depth),
            new Rectangle(screen.X, screen.Y + depth, depth, sides),
            new Rectangle(screen.Right - depth, screen.Y + depth, depth, sides),
        };
    }

    public void Dispose()
    {
        for (int index = 0; index < _windows.Length; index++)
        {
            if (_strips[index] != null) _strips[index].Dispose();
            if (_windows[index] != null) _windows[index].Dispose();
        }
    }
}
}
