namespace DshCu
{

public sealed class PanelForm : LayeredWindow
{
    private const double MaxWidth = 1000;
    private const double SideMargin = 32;
    private const double TopMargin = 6;

    private readonly PanelRenderer _renderer;
    private PanelState _drawn;

    public PanelForm(Rectangle screen)
        : base(Frame(screen))
    {
        _renderer = new PanelRenderer(Width);
        AccessibleRole = AccessibleRole.StaticText;
    }

    public void Update(PanelState state)
    {
        if (state.SameAs(_drawn)) return;
        AccessibleName = PanelRenderer.Title(state) + ". " + state.Action + ". Press Escape " + PanelRenderer.Hint(state);
        _renderer.Draw(this, state);
        _drawn = state.Copy();
    }

    private static Rectangle Frame(Rectangle screen)
    {
        int width = Math.Min(screen.Width - Theme.Px(SideMargin), Theme.Px(MaxWidth));
        if (width < Theme.Px(360)) width = screen.Width;
        int height = PanelRenderer.CanvasHeight();
        return new Rectangle(
            screen.X + (screen.Width - width) / 2,
            screen.Y + Theme.Px(TopMargin),
            width,
            height);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && _renderer != null) _renderer.Dispose();
        base.Dispose(disposing);
    }
}
}
