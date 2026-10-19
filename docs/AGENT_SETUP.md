# Set Up OpenCode Computer Use as an Agent

Use these steps when the user asks you to install this repository into OpenCode. This is setup
guidance; the runtime desktop workflow is in [opencode/SKILL.md](../opencode/SKILL.md).

## Installation procedure

1. Read the repository's [AGENTS.md](../AGENTS.md) and [installation guide](INSTALL.md).
2. Confirm that you are on Windows outside WSL. Locate the permanent repository folder,
   `node.exe`, Windows PowerShell 5.1 and OpenCode. Record versions without printing credentials.
3. Run `node src/verify.js` and `node test/run.mjs` from the repository root. Stop on failure.
4. Run the supported installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-opencode.ps1
```

5. Ask the user to restart OpenCode when the running instance cannot reload its configuration.
   Then run `opencode mcp list` and `opencode debug skill`.
6. Confirm `computer` is connected and `opencode-computer-use` is discoverable. In a new OpenCode
   session, call `computer_windows`. Report success only when the actual tool returned windows.

Use `-ConfigDir` and `-ConfigPath` when the user has a custom configuration. Do not overwrite the
whole config or register only the MCP server: the native plugin supplies instructions and lifecycle
cleanup. Keep the repository folder on disk because the configuration contains absolute local paths.

The normal installer preserves the user's model and providers. Do not change them to make a test
pass. If a provider returns 401 or a model is unavailable, explain the provider issue and let the
user select or repair a configured provider. Never ask them to send a secret in chat.

## Verification scope

Static checks, discovery and window observation do not need input injection. A real input test
requires an unlocked desktop and a dedicated fixture. Run `node src/cli.js self-test` only when
desktop testing is within the user's requested work. It operates its own window and saves a report.
Do not inject test input into the user's active editor or replace their clipboard.

`node test/opencode-smoke.mjs <path-to-opencode.exe>` uses a local model fixture and an isolated
OpenCode configuration. It tests actual plugin loading, tools, countdown and cleanup without an
external model request or mouse/keyboard input. First-run OpenCode dependency resolution may
still use the network. The separate `test/opencode-live.mjs` uses a real provider and must be
within the user's authorized model usage and desktop testing scope.

Physical ESC represents the user's decision to stop. Never clear its cancellation state, hide
the indicator, remove a gate, or invoke shell input to get around it. An unavailable desktop is
a failed test, not a reason to weaken a check.

## Completion report

Report the repository location, config file path, whether a backup was created, tool connection
and skill discovery results, OpenCode and Node versions, and any restart still needed. Do not
print config values or credentials. Distinguish static validation, actual MCP connection, desktop
input tests and a model completing a task.

For updates, stay in the existing installation folder and rerun its installer. Keep the installation folder in place. To relocate it, uninstall from the current folder and
install from the new one. Do not overwrite an unrelated computer server. Preserve user edits and other
MCP servers. Use the same installer with `-Uninstall` for removal.

## A prompt users can give a setup agent

```text
Install this repository as a local OpenCode computer-use integration on my Windows machine.
Read AGENTS.md and docs/AGENT_SETUP.md. Keep the repository in a permanent folder. Use
install-opencode.ps1 and preserve my models, providers, credentials and unrelated MCP servers.
Verify the contract, unit tests, computer MCP connection and opencode-computer-use skill.
Use only window observation for the first check; do not click or type in my applications.
Tell me whether I must restart OpenCode and where the configuration backup is stored.
```
