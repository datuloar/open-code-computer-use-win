namespace DshCu
{

public sealed class PanelState
{
    public bool Announcing;
    public int SecondsLeft;
    public double Remaining;
    public double Pulse;
    public string Action;
    public double ActionOpacity;

    public PanelState()
    {
        Action = "";
    }

    public bool SameAs(PanelState other)
    {
        return other != null
            && other.Announcing == Announcing
            && other.SecondsLeft == SecondsLeft
            && other.Action == Action
            && Math.Abs(other.Remaining - Remaining) < 0.01
            && Math.Abs(other.Pulse - Pulse) < 0.02
            && Math.Abs(other.ActionOpacity - ActionOpacity) < 0.02;
    }

    public PanelState Copy()
    {
        PanelState copy = new PanelState();
        copy.Announcing = Announcing;
        copy.SecondsLeft = SecondsLeft;
        copy.Remaining = Remaining;
        copy.Pulse = Pulse;
        copy.Action = Action;
        copy.ActionOpacity = ActionOpacity;
        return copy;
    }
}
}
