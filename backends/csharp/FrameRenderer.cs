namespace DshCu
{

public static class FrameRenderer
{
    private const double DepthDip = 34;
    private const double CoreDip = 2;
    private const double CornerDip = 18;
    private const double FeatherPx = 1.2;
    private const int CoreAlpha = 224;
    private const int GlowAlpha = 132;

    private static readonly Color Core = Theme.FrameCore;
    private static readonly Color Glow = Theme.Accent;

    public static int Depth()
    {
        return Math.Max(6, Theme.Px(DepthDip));
    }

    public static Bitmap Strip(Rectangle strip, Rectangle screen)
    {
        Bitmap bitmap = Theme.Canvas(strip.Width, strip.Height);
        BitmapData data = bitmap.LockBits(
            new Rectangle(0, 0, bitmap.Width, bitmap.Height),
            ImageLockMode.WriteOnly,
            PixelFormat.Format32bppPArgb);
        try
        {
            int rowBytes = Math.Abs(data.Stride);
            byte[] buffer = new byte[rowBytes * bitmap.Height];
            double depth = Depth();
            double core = Math.Max(1.0, Theme.Pxf(CoreDip));
            double corner = Theme.Pxf(CornerDip);
            for (int y = 0; y < bitmap.Height; y++)
            {
                int row = y * rowBytes;
                for (int x = 0; x < bitmap.Width; x++)
                {
                    double distance = InsideDistance(strip.X + x, strip.Y + y, screen, corner);
                    if (distance >= depth || distance <= -FeatherPx) continue;
                    Color color;
                    int alpha;
                    if (distance < core)
                    {
                        color = Core;
                        alpha = distance < 0
                            ? (int)(CoreAlpha * (1 + distance / FeatherPx))
                            : (int)(CoreAlpha - distance * 16);
                    }
                    else
                    {
                        color = Glow;
                        double t = 1.0 - (distance - core) / (depth - core);
                        alpha = (int)(GlowAlpha * Math.Pow(Theme.Smooth(t), 1.4));
                    }
                    if (alpha <= 0) continue;
                    if (alpha > 255) alpha = 255;
                    int pixel = row + x * 4;
                    buffer[pixel] = (byte)(color.B * alpha / 255);
                    buffer[pixel + 1] = (byte)(color.G * alpha / 255);
                    buffer[pixel + 2] = (byte)(color.R * alpha / 255);
                    buffer[pixel + 3] = (byte)alpha;
                }
            }
            Marshal.Copy(buffer, 0, data.Scan0, buffer.Length);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
        return bitmap;
    }

    private static double InsideDistance(int x, int y, Rectangle screen, double radius)
    {
        double halfWidth = screen.Width / 2.0;
        double halfHeight = screen.Height / 2.0;
        double offsetX = Math.Abs(x + 0.5 - (screen.Left + halfWidth)) - (halfWidth - radius);
        double offsetY = Math.Abs(y + 0.5 - (screen.Top + halfHeight)) - (halfHeight - radius);
        double outside = Math.Sqrt(
            Math.Max(offsetX, 0) * Math.Max(offsetX, 0) + Math.Max(offsetY, 0) * Math.Max(offsetY, 0));
        double inside = Math.Min(Math.Max(offsetX, offsetY), 0);
        return radius - outside - inside;
    }
}
}
