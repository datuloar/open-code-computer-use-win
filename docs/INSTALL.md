# Install OpenCode Computer Use

Install the plugin from a Git clone or release ZIP and keep that folder on disk. The installer
registers local files in OpenCode; there is no package registry step.

## Requirements

| Requirement | Details |
|---|---|
| Windows | Unlocked interactive desktop, primary monitor |
| Windows PowerShell | Version 5.1, launched as `powershell`; PowerShell 7 does not replace the backend host |
| Node.js | Version 18 or newer; Node 24.19.0 was used for the recorded tests |
| OpenCode | Installed and available in your terminal; integration tested with 1.18.25 |
| Model | Any configured provider that supports tool calls; image input is needed for direct screenshot interpretation |
| Git | Needed only for cloning and updates through Git |

Use native Windows tools outside WSL. No administrator session is required for ordinary apps.

## Get the repository

On the GitHub repository page, use **Code > Download ZIP** or clone its URL. GitHub's automatic
source ZIP and the attached release ZIP both contain the runtime and installer. Extract the
whole folder before running anything. A permanent location such as
`$env:LOCALAPPDATA\OpenCode\opencode-computer-use` avoids broken paths after Downloads cleanup.

The examples below use that location. Adjust it if you chose another folder.

```powershell
Set-Location "$env:LOCALAPPDATA\OpenCode\opencode-computer-use"
node --version
opencode --version
node src/verify.js
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1
```

The execution policy option applies to that PowerShell process. It does not change the machine's
stored execution policy. Close and restart OpenCode after installation.

## Move an existing installation

Clone [open-code-computer-use-win](https://github.com/datuloar/open-code-computer-use-win) into its own
permanent folder. From that new folder, replace the explicitly named previous checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1 -MigrateFrom 'C:\path\to\previous-checkout'
```

The installer backs up the configuration, moves only the matching `computer` entry and plugin,
and preserves the provider, model, countdown, enabled setting, timeout and other servers. A different
`computer` server is a conflict and is left unchanged. Restart OpenCode after migration.

## Confirm the connection

```powershell
opencode mcp list
opencode debug skill
```

Expect a connected `computer` MCP server and the `opencode-computer-use` skill. Ask OpenCode:

```text
Load opencode-computer-use. List my open windows with computer_windows.
Do not focus, click or type anything. Report the window titles you observed.
```

This checks discovery and observation without taking over input. A successful model reply alone
does not prove that tools ran; inspect the tool calls in the OpenCode session.

## Configuration changes

The control countdown defaults to five seconds. Save another duration and restart OpenCode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1 -AnnounceSeconds 3
```

The range is 0 to 30 whole seconds. Zero skips the timed wait; the indicator and input safeguards
remain active. The installer stores this setting as a string in
`mcp.computer.environment.DSH_CU_ANNOUNCE_SECONDS` and preserves it on subsequent installations.
Use `-AnnounceSeconds 5` to restore the default. For CLI or other MCP hosts, set
`DSH_CU_ANNOUNCE_SECONDS`; an explicit `overlay --announce N` overrides it for that CLI session.
Agents should leave this user setting alone while performing desktop tasks.

By default the installer uses `~/.config/opencode/opencode.jsonc` if it exists, otherwise
`~/.config/opencode/opencode.json`. `XDG_CONFIG_HOME` changes the configuration base directory.
`OPENCODE_CONFIG` can select the config file. Custom paths are available explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1 -ConfigDir 'D:\OpenCodeConfig'
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1 -ConfigPath 'D:\OpenCodeConfig\opencode.json'
```

`-ConfigDir` selects where the skill and backups go. `-ConfigPath` selects the config file;
combine the two when both locations are custom. Configure OpenCode to load the same location.
See the official [configuration guide](https://opencode.ai/docs/config/).

The installer adds a local plugin URL, a `computer` MCP entry with an absolute Node path, and
the skill. At startup the plugin adds desktop instructions and binds its own control identity.
These instructions tell OpenCode when to use desktop tools, how to choose a small observation,
when to load the detailed skill and how to verify the result. They load automatically in new
sessions. After setup, ask for your app task in ordinary language.
Providers, keys, permissions, existing model selection and unrelated servers are preserved.
An explicit `mcp.computer.enabled: false` and custom timeout are preserved too; restart does not
silently re-enable desktop tools. Change that setting to true yourself when you want to enable them.
JSONC comments remain in the backup; the updated file is normalized to JSON.

Backups are stored under `<config directory>\backups\computer-use\<timestamp>`. Repeating an
unchanged installation makes no new backup. Never upload this directory or your OpenCode config
to GitHub: either may contain credentials.

Installation does not select or purchase a model. If you explicitly want to change the default:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1 -Model 'provider/model'
```

Replace `provider/model` with an available model you have configured. A text-only model can read
UIA and OCR; `computer_see` adds optional local vision after `install-vision.ps1` is installed.

## Update

Close OpenCode, update the same folder, then rerun the installer:

```powershell
git pull --ff-only
node src/verify.js
node test/run.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1
```

For a downloaded ZIP, extract the new release separately, close OpenCode, uninstall from the old
folder, and install from the new permanent folder. Do the same before moving or renaming a clone.
This avoids two plugin URLs and a conflicting `computer` entry. Keep user edits or local commits
before replacing a folder.

## Remove

Run from the installed folder, with the same custom path flags if you used them:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1 -Uninstall
```

Restart OpenCode. The installer removes its own plugin URL and MCP entry. It deletes the skill
only if the file still matches the distributed copy; edited skills remain. Backups remain.
Once uninstalled, the repository folder can be removed. Optional vision files are separate.

## Troubleshoot

| Symptom | Action |
|---|---|
| `node` or `opencode` is not found | Install that prerequisite, open a new PowerShell terminal, and check its version again |
| `computer` is already in use | Inspect the existing MCP entry. Uninstall the old copy if it is this plugin; preserve an unrelated server and resolve its name before installing |
| MCP will not connect | Keep the full repository on disk, rerun the installer from its current location, and check `node src/cli.js doctor` |
| Tools or skill do not appear | Restart OpenCode, check the selected configuration path, and inspect project configuration that may override global settings |
| The model returns 401 | Fix the provider in OpenCode or choose another configured model. The plugin does not supply provider credentials |
| Screenshot is unreadable to the model | Use UIA/OCR or a model with image input. A screenshot path does not provide sight to a text-only model |
| Input refuses after ESC | Respect the human stop. Do not delete state or bypass the gate; ask the user before any later resumption |
| Target is covered or ambiguous | Focus the intended window, read again, and choose an observed unique target |
| Cursor was hidden by an interrupted indicator | Press ESC, or use `bin\opencode-cu.cmd overlay --restore-cursor` for this tool's stranded cursor state |

Do not paste a full `opencode debug config` output into a public issue: resolved configuration
may include secrets. Share the failing command, error message, versions and redacted paths instead.

The integration uses OpenCode's [local MCP servers](https://opencode.ai/docs/mcp-servers/),
[plugin hooks](https://opencode.ai/docs/plugins/) and [agent skills](https://opencode.ai/docs/skills/).
