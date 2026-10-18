namespace DshCu
{

public static class StateFiles
{
    public static readonly string Heartbeat = InTemp("dsh-cu.alive");

    public static readonly string Ready = InTemp("dsh-cu.ready");

    public static readonly string Stop = InTemp("dsh-cu.stop");

    public static readonly string Touch = InTemp("dsh-cu.touch");

    public static readonly string Pid = InTemp("dsh-cu.pid");

    public static readonly string Owner = InTemp("dsh-cu.owner");

    public static readonly string CursorHidden = InTemp("dsh-cu.cursor");

    public static readonly string Action = InTemp("dsh-cu.action");

    public static readonly string HumanStop = InTemp("dsh-cu.cancelled");

    public static readonly string BrokerReady = InTemp("dsh-cu.broker.ready");

    public static readonly string BrokerStop = InTemp("dsh-cu.broker.stop");

    public static string InTemp(string name)
    {
        return System.IO.Path.Combine(System.IO.Path.GetTempPath(), name);
    }

    public static void Write(string path, string content)
    {
        try { System.IO.File.WriteAllText(path, content); }
        catch { }
    }

    public static string Read(string path)
    {
        try { return System.IO.File.ReadAllText(path).Trim(); }
        catch { return ""; }
    }

    public static void Delete(string path)
    {
        try { System.IO.File.Delete(path); }
        catch { }
    }

    public static long Stamp(string path)
    {
        try
        {
            if (!System.IO.File.Exists(path)) return 0;
            return System.IO.File.GetLastWriteTimeUtc(path).Ticks;
        }
        catch
        {
            return 0;
        }
    }

    public static double AgeSeconds(string path)
    {
        long stamp = Stamp(path);
        if (stamp == 0) return double.MaxValue;
        return (DateTime.UtcNow - new DateTime(stamp, DateTimeKind.Utc)).TotalSeconds;
    }

    public static bool StopRequested()
    {
        string request = Read(Stop);
        if (request.Length == 0) return false;
        return !request.StartsWith("owner ", StringComparison.Ordinal) || request.Substring(6) == Read(Owner);
    }

    public static void RequireInput()
    {
        if (Environment.GetEnvironmentVariable("DSH_CU_ALLOW_NO_INDICATOR") == "1") return;
        string client = Environment.GetEnvironmentVariable("DSH_CU_OWNER");
        if (!string.IsNullOrEmpty(client) && Read(Owner) != client)
            throw new InvalidOperationException("another computer-use client owns the desktop; wait for it to stop");
        string owner = Read(Pid);
        string[] fields = owner.Split(' ');
        int pid;
        long ticks;
        bool alive = false;
        if (fields.Length == 2 && int.TryParse(fields[0], out pid) && long.TryParse(fields[1], out ticks) && ticks > 0)
        {
            try
            {
                using (Process process = Process.GetProcessById(pid))
                {
                    alive = !process.HasExited && process.ProcessName == "powershell" &&
                        Math.Abs(process.StartTime.ToUniversalTime().Ticks - ticks) < TimeSpan.TicksPerSecond * 5;
                }
            }
            catch { }
        }
        if (!alive || AgeSeconds(Heartbeat) >= 5 || StopRequested() || AgeSeconds(HumanStop) < 600)
            throw new InvalidOperationException("the on-screen indicator is not running or the human stopped control");
        if (Read(Ready) != owner)
            throw new InvalidOperationException("the on-screen countdown is still running; wait for the announcement to finish");
    }
}
}
