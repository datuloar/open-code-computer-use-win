namespace DshCu
{

public static class SystemCursors
{
    private const uint SpiSetCursors = 0x0057;
    private const int CursorSize = 32;

    public static void Hide()
    {
        StateFiles.Write(StateFiles.CursorHidden, DateTime.UtcNow.ToString("O"));
        byte[] andMask = new byte[CursorSize * CursorSize / 8];
        for (int index = 0; index < andMask.Length; index++) andMask[index] = 0xFF;
        byte[] xorMask = new byte[CursorSize * CursorSize / 8];
        foreach (uint id in Native.StandardCursorIds)
        {
            IntPtr blank = Native.CreateCursor(IntPtr.Zero, 0, 0, CursorSize, CursorSize, andMask, xorMask);
            if (blank == IntPtr.Zero) continue;
            if (!Native.SetSystemCursor(blank, id)) Native.DestroyCursor(blank);
        }
    }

    public static void Restore()
    {
        while (Native.ShowCursor(true) < 0) { }
        bool reloaded = Native.SystemParametersInfo(SpiSetCursors, 0, IntPtr.Zero, 0);
        if (reloaded) StateFiles.Delete(StateFiles.CursorHidden);
    }
}
}
