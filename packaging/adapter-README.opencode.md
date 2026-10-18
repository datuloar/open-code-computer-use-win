# OpenCode Adapter

This directory contains the local plugin entry, branded MCP entry, runtime instructions and
`opencode-computer-use` skill. The backend and CLI are shared with the DSH integration.

- Users: [install, update and remove](../docs/INSTALL.md).
- Setup agents: [installation procedure](../docs/AGENT_SETUP.md).
- Desktop agents: [runtime skill](SKILL.md).
- Maintainers: [publish the GitHub package](../docs/PUBLISHING.md) and [validate it](../docs/VALIDATION.md).

Run `install-opencode.ps1` from the repository root, then restart OpenCode. Keep the full
repository folder on disk. Copying only `plugin.js` loses its imports and the Windows backend.
