# Agent Instructions for OpenCode Computer Use

This repository distributes a Windows backend, CLI, MCP server and native OpenCode plugin.
For installing it for a user, follow [docs/AGENT_SETUP.md](docs/AGENT_SETUP.md).
For operating the desktop, read [opencode/SKILL.md](opencode/SKILL.md).

## Project map

| Path | Purpose |
|---|---|
| `install-opencode.ps1`, `src/install-opencode.js` | Configuration merge, backup, rollback and removal |
| `opencode/plugin.js`, `src/opencode.js` | Native hooks and session cleanup |
| `opencode/mcp.js`, `src/mcp.js` | Branded entry and shared MCP tool table |
| `src/commands.js`, `src/cli.js` | Single CLI command table, validation and entry point |
| `src/settings.js` | Countdown default and duration validation |
| `src/backend.js`, `src/host.js` | Process transport, state files and warm backend |
| `backends/windows.ps1` | Windows dispatch, indicator and elevated broker |
| `backends/csharp/` | C# 5 input, UI Automation and indicator implementation |
| `src/control-wait.js`, `backends/csharp/ControlState.cs` | Bounded observations and cancellable named-control waits |
| `opencode/SKILL.md`, `opencode/INSTRUCTIONS.md` | Runtime agent guidance |
| `src/package-opencode.js`, `packaging/` | Reproducible GitHub export and English documentation |
| `test/`, `src/selftest.js` | Unit, integration and isolated desktop checks |

## Required rules

- Maintain this product in `datuloar/open-code-computer-use-win` and its own checkout. Use its own source, installation paths, settings and release pipeline.

- Do not add code comments in JS, C#, PowerShell or YAML. Put explanations in documentation.
- The package is `opencode-computer-use`, its native entry is `opencode/plugin.js`, the CLI is
  `opencode-cu`, the skill is `opencode-computer-use` and the MCP entry is `computer`.
- Distribute the repository and release ZIP without registry publication or runtime dependencies.
- `src/commands.js` is the single CLI command table. The package builder generates the README
  reference. Keep runtime guidance in `opencode/SKILL.md` and run `node src/verify.js`.
- Input must wait for the visible countdown and valid owner/readiness state. Do not bypass physical
  ESC, share another client's owner, or resume because a cancellation timer expired.
- The countdown defaults to five seconds. Preserve the user's `OPENCODE_CU_ANNOUNCE_SECONDS` setting
  on reinstall; explicit CLI `--announce` overrides it. Invalid settings must still allow cleanup.
- Releases must work after the gate closes. Never retry a broker request that was already taken.
  Partial input must be observed before a retry.
- Cursor replacement is opt-in. Preserve the cursor marker, all restore paths and the default
  ring around the real cursor. Do not repair a cursor hidden by another program.
- Validate all coordinates before input, including the destination before pressing for a drag.
  Keep input within the supported primary screen and Windows coordinate limits.
- Inspect values only after non-password metadata is confirmed; preserve whitespace, null states
  and truncation. Exact names precede enabled filtering. Conditional waits remain read-only,
  deadline bounded and cancellable; timeout or ambiguity must never become ready.
- Use `OPENCODE_CU_ARGV` JSON for backend arguments. Never turn typed text into PowerShell parameters.
- State reads race with cleanup. Treat missing or unreadable state as normal. Never stop a process
  by PID alone; preserve process type and start-time verification.
- Keep owner-bound stop requests, startup and lifetime mutexes, atomic broker files, backend
  timeouts and MCP cancellation cleanup. Stdout is reserved for JSON-RPC when serving MCP.
- The warm backend must not enter a blocking indicator/broker loop or call `exit` inside dispatch.
- C# must remain C# 5 and ASCII for the Windows .NET Framework compiler. Add one type per file;
  register it in the PowerShell source list. Shared `using` directives belong in `Interop.cs`.
- UIA references are `UIAutomationClient`, `UIAutomationTypes` and `WindowsBase`. Do not introduce
  conflicting `System.Windows` drawing types; qualify `System.Windows.Rect` explicitly.
- Keep visual constants in `Theme.cs`, use DPI scaling helpers and premultiplied alpha surfaces.
  Preserve four edge strips instead of a full-screen glow bitmap.
- `tap` must refuse ambiguous and covered controls. Keep Chromium accessibility warmup and the
  refusal to use minimized window coordinates. UIA is not a browser DOM.
- An observed role can disambiguate a container and its child; duplicates within the same role
  still fail. A popup is clickable only when its native hit surface belongs to the selected
  control's UIA ancestry. Sharing a process or owner alone does not prove visibility.
- Focusing a window preserves its current size and maximized state. Restore only minimized windows.
- Configuration changes preserve unrelated settings and create backups. Do not print or package
  user configs, credentials, machine paths, screenshots of user apps or optional vision weights.
- The package builder copies only its allowlist, rejects symlinks, and refuses an existing output
  directory. Do not replace it with a recursive copy of the workspace or Git history.

## Verification

Run `node src/verify.js` and `node test/run.mjs` after relevant changes. The unit runner imports
tests in process.

Desktop self-test controls only `test/desktop-fixture.ps1`. Never inject test input into the
user's current app, replace the clipboard, or kill editors by process name. An unavailable or
interrupted desktop is a failed run. Preserve failed and unfinished `report.json` files.

Use `test/opencode-smoke.mjs` for an actual OpenCode integration check with an isolated local
model fixture. Live model tests need authorized model usage. Physical ESC is a separate human test.
Do not claim general superiority over UI-TARS from source comparisons or our own regression count.
