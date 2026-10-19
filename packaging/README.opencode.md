# OpenCode Computer Use for Windows

Give OpenCode tools to inspect and operate Windows apps. Read controls through UI Automation,
use OCR or screenshots when needed, and send mouse and keyboard input with a visible countdown
and a physical ESC stop.

This is the standalone [OpenCode repository](https://github.com/datuloar/open-code-computer-use-win).
It includes its own plugin, MCP server, agent skill and Windows backend.
Run it from a clone or an extracted release. No package install, native driver or .NET SDK is required.

The plugin automatically loads a short desktop workflow into OpenCode. The discoverable skill
adds targeting, input and verification guidance when needed, and a compaction reminder preserves
the rules in long sessions. Describe the task normally; you do not have to name tools or paste
a desktop prompt each time.

![OpenCode countdown and active desktop control](docs/opencode-indicator.png)

## Install

You need Windows, an unlocked interactive desktop, Windows PowerShell 5.1, Node.js 18 or newer,
and OpenCode with a working model provider. The integration was tested with OpenCode 1.18.25
and Node.js 24.19.0. Run these commands in Windows PowerShell, outside WSL.

1. Clone this repository or extract its release ZIP to a permanent folder.
2. Open PowerShell in that folder and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1
opencode mcp list
opencode debug skill
```

3. Restart OpenCode. `computer` should be connected and `opencode-computer-use` should appear
   in the skill catalog.
4. Try: `List my open windows with computer_windows. Do not click or type anything.`

The installer preserves your provider, model, credentials and other MCP servers. It backs up
changed files before merging the configuration. Keep the repository folder where it is:
OpenCode loads the plugin and backend from that folder.

Read [installation and troubleshooting](docs/INSTALL.md) for custom configuration paths,
updates and removal. Give a setup agent [AGENT_SETUP.md](docs/AGENT_SETUP.md).

## Desktop workflow

Ask OpenCode to inspect a specific app, then describe the change you want. The agent lists
windows, reads the target, performs an action and inspects the result. The first input displays
a five second countdown by default. Press physical ESC to take back control.
Save a different duration with `install-opencode.ps1 -AnnounceSeconds 3`, then restart OpenCode.
The supported range is 0 to 30 seconds; zero keeps the indicator and skips the timed wait.

- `computer_ui_tree` and `computer_find` return controls as text with physical pixel coordinates.
- `computer_tap` clicks a uniquely named control and refuses ambiguous or covered targets.
- `computer_read_text` uses Windows OCR. `computer_screenshot` returns an image to vision models.
- `computer_type` preserves Unicode and whitespace without replacing the clipboard.
- `computer_find` with `details: true` reads a field value and state, with password redaction and
  explicit truncation. `computer_wait` with text, pid and seconds waits for a named control.
- `computer_indicator` with `{"action":"stop"}` releases control. Lifecycle hooks also stop
  owned control when the session ends or moves to other kinds of tools.

The primary monitor is supported. UI Automation is not a browser DOM. Secure desktop and UAC
dialogs are outside this tool's supported input surface. Optional local vision requires a separate
download through `install-vision.ps1`. A screenshot sent to a cloud model goes to that model provider.
See [desktop behavior and limits](docs/SAFETY.md).

The [alternatives review](docs/opencode-alternatives-2026-10-18.md) compares pinned GitHub sources
and explains the changes adopted in 1.0.0. Other projects were reviewed as source, not benchmarked.

## Verify

```powershell
node src/verify.js
node test/run.mjs
```

These checks do not drive the desktop. For a real input test in a dedicated fixture window:

```powershell
node src/cli.js self-test
```

The fixture must stay visible and accept input. It saves `report.json` and screenshots in its
reported temp folder. Physical ESC needs a separate human check. See [validation](docs/VALIDATION.md)
for the OpenCode integration test and the limits of the recorded results.

## Publish and maintain

Follow [PUBLISHING.md](docs/PUBLISHING.md) to build a release ZIP or publish a version tag.
GitHub Actions runs static checks and unit tests on pushes and pull requests;
version tags build a ZIP and SHA256 checksum file.

The package and skill are `opencode-computer-use`, the CLI is `opencode-cu`, and the MCP name
is `computer`. The root package export is the native OpenCode plugin. Contributors should read
[AGENTS.md](AGENTS.md).

## CLI reference

Use `bin\opencode-cu.cmd <command>` for the OpenCode appearance or `node src/cli.js <command>`
for the shared CLI. The command list below is generated from `src/commands.js` during packaging.

{{CLI_REFERENCE}}

## License

MIT. See [LICENSE](LICENSE).
