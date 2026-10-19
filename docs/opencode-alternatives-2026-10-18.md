# OpenCode Computer Use Alternatives and Adopted Improvements

Reviewed October 18, 2026. The installed OpenCode is 1.18.25. Its documented
[built-in tool catalog](https://opencode.ai/docs/tools/) lists coding, file, shell and web tools;
desktop control is supplied through integrations such as MCP. A separate computer-use repository
under the same organization does not register tools in an installed OpenCode instance automatically.

This is a pinned source review, not a runtime benchmark of these other projects. Their servers were
not installed or executed. The reviewed repositories identify their licenses as MIT. No upstream
implementation was copied or vendored in this change; the features below use our shared backend
and standard Microsoft UI Automation interfaces.

## Projects reviewed

| Project and pinned revision | Relevant behavior | Decision for this integration |
|---|---|---|
| [anomalyco/computer-use, 41c5294](https://github.com/anomalyco/computer-use/tree/41c5294cfe4735baca03f9c82b4de99d191a0b49) | A fork of iFurySt/open-computer-use, distributed as a separate MCP service with an OpenCode installer. Its Windows runtime records accessibility elements and bounded ValuePattern text. | Add explicit, bounded control-value inspection rather than treating an accessible name as field contents. |
| [CursorTouch/Windows-MCP, 128f296](https://github.com/CursorTouch/Windows-MCP/tree/128f2960c79b74bd2630f4dbc9d4f664f4ce89b3) | Windows/Python server. WaitFor polls UI state within one request; its control layer also distinguishes observation from desktop interference. | Add a named conditional wait that sends no input and does not start control. Keep our existing announcement, owner and cancellation rules. |
| [cenglin123/computer-use-mcp, 7b0aa99](https://github.com/cenglin123/computer-use-mcp/tree/7b0aa991bcc229ea6c7df033253a556256b755a4) | Windows/Python tools include accessibility state, password metadata and bounded control waits. | Preserve explicit unavailable/truncated observations and reject ambiguous selection. Keep exact-name selection ahead of enabled substring matches. |
| [mirsella/computer-use-mcp, 2a3ef4d](https://github.com/mirsella/computer-use-mcp/tree/2a3ef4d230a22dd7fa3c81343db0ab26eec54896) | KDE Plasma Wayland/Rust server. Its plugin respects explicit server settings and can expose compact help/dispatch tools. The pinned plugin targets a newer OpenCode API. | Preserve enabled:false and custom timeouts in our 1.18 adapter. Extend existing named tools so per-tool rules remain clear; do not transplant the incompatible adapter. |

Implementation sources: Anomaly's [Windows runtime](https://github.com/anomalyco/computer-use/blob/41c5294cfe4735baca03f9c82b4de99d191a0b49/apps/OpenComputerUseWindows/runtime.ps1),
Windows-MCP's [WaitFor tools](https://github.com/CursorTouch/Windows-MCP/blob/128f2960c79b74bd2630f4dbc9d4f664f4ce89b3/src/windows_mcp/tools/input.py),
cenglin's [UI Automation](https://github.com/cenglin123/computer-use-mcp/blob/7b0aa991bcc229ea6c7df033253a556256b755a4/computer_use/ui_automation.py),
and mirsella's [plugin configuration](https://github.com/mirsella/computer-use-mcp/blob/2a3ef4d230a22dd7fa3c81343db0ab26eec54896/plugin/computer-use.mjs).

The earlier ByteDance UI-TARS review remains separate. UI-TARS Desktop has its own model loop,
browser operator and session-history features. Our changes do not supply a browser DOM operator,
cross-platform execution or a measured task win rate against it.

## What changed in version 1.0.0

### Read exact accessible values

Use the existing MCP tool:

```json
{"pid":1234,"text":"Test editor","details":true,"max_chars":2000}
```

with computer_find. The manual equivalent is `opencode-cu inspect "Test editor" --pid 1234`.
It returns JSON with the selected control, enabled/focused state, value, source, read-only status
and optional toggle/selection state. ValuePattern is preferred; TextPattern is the bounded fallback.
Compare a complete value only when valueStatus is available and truncated is false. Whitespace is
preserved. The default limit is 1000 characters and the maximum is 2000.

Password contents are never requested. Unknown password metadata prevents text reads. Unsupported
patterns and provider failures return an explicit status and null value. These rules follow
[Microsoft's edit-control requirements](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-support-for-the-edit-control-type).
A supported application can still supply inaccurate accessibility information; the result describes
what its provider exposed.

### Wait for a named control

Use computer_wait with a positive deadline of at most 30 seconds:

```json
{"pid":1234,"text":"Save","seconds":5,"state":"enabled"}
```

State exists also accepts a disabled control. Plain seconds retains the original delay behavior.
The manual command is `opencode-cu wait-control "Save" --pid 1234 --seconds 5`.
The wait performs bounded observations inside one call, supports cancellation, returns the final
observation and poll count, and refuses timeout or ambiguity. It does not focus, click, move the
pointer or start an indicator. An enabled result does not prove that a target is uncovered; tap
checks coverage at action time.

### Preserve explicit OpenCode settings

Installation and native startup keep a user's disabled computer MCP entry and custom timeout.
A disabled integration does not add automatic desktop instructions. Existing countdown, provider,
permission and unrelated server settings remain in place. Re-enable it through the user's normal
configuration when requested.

### Keep model overhead bounded

No additional MCP tool names were added. Details extend find and conditional readiness extends
wait. The serialized tool catalog grows from 6492 to 6666 bytes in this revision, staying under the
existing 7000-byte check. These byte counts are not token or cost measurements. The practical goal
is fewer full observations when a named value or ready condition supplies the needed evidence.

## Validation scope

Pure tests cover bounds, cancellation, late observations, disabled controls, provider errors and
configuration preservation. Desktop tests use our isolated Windows Forms fixture for exact Unicode
and whitespace, password redaction, truncation, toggle/read-only state, disabled exact-name refusal
and conditional waiting without input. The actual OpenCode loopback test checks that the updated
guidance reaches model requests. Live model task results are recorded separately from backend tests.

The initial desktop run exposed a disabled scrollbar inheriting its editor's name. Selection now
prefers exact names, then enabled controls within that same match class. A disabled exact button
cannot redirect input to an enabled substring. The failed run was preserved rather than counted as
passing. No universal superiority, zero-failure rate or general token saving is established here.
