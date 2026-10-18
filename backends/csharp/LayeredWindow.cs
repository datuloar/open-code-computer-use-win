namespace DshCu
{

public class LayeredWindow : Form
{
    public LayeredWindow(Rectangle bounds)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= Native.WS_EX_LAYERED
                | Native.WS_EX_TRANSPARENT
                | Native.WS_EX_TOOLWINDOW
                | Native.WS_EX_NOACTIVATE;
            return parameters;
        }
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    public void Present(Bitmap bitmap, int constantAlpha)
    {
        if (!IsHandleCreated || bitmap == null) return;
        IntPtr screenDc = Native.GetDC(IntPtr.Zero);
        IntPtr memoryDc = Native.CreateCompatibleDC(screenDc);
        IntPtr handle = bitmap.GetHbitmap(Color.FromArgb(0));
        IntPtr previous = Native.SelectObject(memoryDc, handle);
        try
        {
            Native.SIZE size = new Native.SIZE();
            size.cx = bitmap.Width;
            size.cy = bitmap.Height;
            POINT source = new POINT();
            POINT destination = new POINT();
            destination.X = Left;
            destination.Y = Top;
            BLENDFUNCTION blend = new BLENDFUNCTION();
            blend.BlendOp = Native.AC_SRC_OVER;
            blend.SourceConstantAlpha = (byte)Math.Max(0, Math.Min(255, constantAlpha));
            blend.AlphaFormat = Native.AC_SRC_ALPHA;
            Native.UpdateLayeredWindow(
                Handle,
                screenDc,
                ref destination,
                ref size,
                memoryDc,
                ref source,
                0,
                ref blend,
                Native.ULW_ALPHA);
        }
        finally
        {
            Native.SelectObject(memoryDc, previous);
            Native.DeleteObject(handle);
            Native.DeleteDC(memoryDc);
            Native.ReleaseDC(IntPtr.Zero, screenDc);
        }
    }
}
}
