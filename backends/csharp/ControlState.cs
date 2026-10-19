namespace DshCu
{

public static class ControlState
{
    public static string Inspect(AutomationElement window, string name, int maxChars)
    {
        if (maxChars < 1 || maxChars > 2000)
            throw new InvalidOperationException("max chars must be between 1 and 2000");
        UiTree.Node node = UiTree.Optional(window, name);
        if (node == null) return "{\"found\":false}";
        AutomationElement element = node.Element;
        node.Enabled = element.Current.IsEnabled;
        bool focused = element.Current.HasKeyboardFocus;
        string value = null;
        string status = "unavailable";
        string source = null;
        bool truncated = false;
        bool? readOnly = null;
        string toggle = null;
        bool? selected = null;
        object pattern;
        object password = element.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty, true);
        if (password is bool && (bool)password)
        {
            status = "protected";
        }
        else if (password is bool)
        {
            status = "unsupported";
            try
            {
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                {
                    ValuePattern.ValuePatternInformation current = ((ValuePattern)pattern).Current;
                    readOnly = current.IsReadOnly;
                    value = current.Value ?? "";
                    source = "ValuePattern";
                    status = "available";
                }
                else if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
                {
                    value = ((TextPattern)pattern).DocumentRange.GetText(maxChars + 1) ?? "";
                    source = "TextPattern";
                    status = "available";
                }
                if (value != null && value.Length > maxChars)
                {
                    value = value.Substring(0, maxChars);
                    truncated = true;
                }
            }
            catch
            {
                value = null;
                status = "unavailable";
                source = null;
                readOnly = null;
            }
        }
        if (status != "protected")
        {
            try
            {
                if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
                    toggle = ((TogglePattern)pattern).Current.ToggleState.ToString();
            }
            catch { }
            try
            {
                if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
                    selected = ((SelectionItemPattern)pattern).Current.IsSelected;
            }
            catch { }
        }
        return "{\"found\":true,\"control\":" + node.Json() +
            ",\"focused\":" + (focused ? "true" : "false") +
            ",\"value\":" + Quote(value) + ",\"valueStatus\":" + Quote(status) +
            ",\"valueSource\":" + Quote(source) + ",\"truncated\":" + (truncated ? "true" : "false") +
            ",\"readOnly\":" + Boolean(readOnly) + ",\"toggle\":" + Quote(toggle) +
            ",\"selected\":" + Boolean(selected) + "}";
    }

    private static string Boolean(bool? value)
    {
        return value.HasValue ? (value.Value ? "true" : "false") : "null";
    }

    private static string Quote(string value)
    {
        if (value == null) return "null";
        StringBuilder text = new StringBuilder("\"");
        for (int index = 0; index < value.Length; index++)
        {
            char character = value[index];
            if (character == '"' || character == '\\') text.Append('\\').Append(character);
            else if (character < ' ') text.Append("\\u").Append(((int)character).ToString("x4"));
            else text.Append(character);
        }
        return text.Append('"').ToString();
    }
}
}
