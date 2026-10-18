# Validate OpenCode Computer Use

Run code checks before installing, use an isolated configuration for integration checks, and use
the dedicated fixture for real mouse and keyboard tests. These levels verify different behavior.

## Static and unit checks

```powershell
node src/verify.js
node test/run.mjs
node src/package-opencode.js --check .
```

The contract checks command documentation, DSH registration and the OpenCode adapter. Unit tests
exercise parsing, host recovery, cancellation, configuration preservation, rollback and packaging.
The package check verifies the export manifest; run it before changing the exported files.
None of these checks inject desktop input or requires model credentials.

## OpenCode integration

```powershell
node test/opencode-smoke.mjs 'C:\Path\To\opencode.exe'
```

Pass the actual OpenCode executable, not Node and not a PowerShell shim. The test creates an
isolated config, installs this copy there and runs OpenCode against a loopback model fixture.
It checks `computer_windows`, indicator countdown, automatic instructions and cleanup before a
normal file read. It makes no external model request and sends no mouse or keyboard input.
OpenCode may download its normal dependencies on first use.

The test refuses an already active desktop session or a recent human ESC. Reports and JSONL
events remain in its reported temp folder. It does not change the user's installed plugin,
default model, provider configuration or credentials.

## Interactive desktop

On an unlocked desktop that you are ready to hand over:

```powershell
$env:DSH_CU_THEME = 'opencode'
node src/cli.js self-test
Remove-Item Env:\DSH_CU_THEME
```

Keep the fixture visible and unobstructed. The suite checks Unicode and whitespace, clipboard
sequence preservation, unique and ambiguous controls, covered targets, bounds, screenshot pixels,
input gating, cancellation, cursor recovery, ownership and disconnect cleanup. The fixture and
server close afterward. Failed runs remain failed; interruptions are not counted as passes.

Each run records `report.json`, timings, Windows/Node details and a source fingerprint. Programmatic
stop and MCP cancellation timings are not physical ESC latency. Test physical ESC separately as
a human. Elevated broker/UAC, secondary monitors and model task success are outside this suite.

## Live model

After installing this copy into the intended OpenCode configuration:

```powershell
node test/opencode-live.mjs 'provider/model' 'C:\Path\To\opencode.exe'
```

Use a configured model with tool calls and image input. This sends real provider requests and
can consume that provider's quota or credits. The test opens its own fixture and independently
checks that the field contains exactly `OpenCode verified`, then confirms control is released.
Do not run it merely to test package integrity.

## Recorded baseline

On October 18, 2026, the shared backend passed 25 desktop scenarios in the original theme and
25 in the OpenCode theme on Windows 10.0.26200, Node 24.19.0, 2560 by 1440 at 96 DPI.
The OpenCode adapter also completed a real model fixture task with OpenCode 1.18.25 before
packaging. The release export has additional unit and installation checks.

These are scoped observations. They do not prove zero failures in every app or a higher task
success rate than UI-TARS. A useful comparison needs identical tasks, independent application
state checks, repeated attempts and separate reporting of model, environment, time and cost.

## Documentation review

Antislop writing review: PASS. The package guides are English, use working relative links,
state prerequisites next to commands, preserve provider choice and distinguish code checks
from desktop or live model tests. The package adds no new product interface or visual assets.
