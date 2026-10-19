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
It also loads the skill through OpenCode and checks that the model receives tool routing,
small-region observation, partial-input verification and session efficiency guidance automatically.
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

Use a configured model with tool calls and either image input or usable Windows OCR. This sends real provider requests and
can consume that provider's quota or credits. The test opens its own fixture and independently
checks that the field contains exactly `OpenCode verified`, then confirms control is released.
Do not run it merely to test package integrity.

A test-only plugin rejects coordinate input and foreign window targets, and refuses typing or
key presses when the fixture is not foreground. The test records the control owner and requests
its stop even if the model process times out. It never relaxes a production input gate.
The test permits `computer_*` and this skill only within its OpenCode process configuration;
the fixture guard still enforces the input target. User permission settings are not rewritten.

Add `--natural` to check how the model uses the installed guidance without a tool-by-tool prompt:

```powershell
node test/opencode-live.mjs 'provider/model' 'C:\Path\To\opencode.exe' --natural
```

This mode gives the model only the goal and the fixture's title. It checks target discovery,
UIA use, skill loading before input, a single typing call, exact value verification and control
release. The report records tool and screenshot counts. One completed task is a behavior check,
not a general estimate of model reliability or token savings.
An optional `--variant low` selects a model's supported reasoning preset for that run.

## Recorded baseline

On October 18, 2026, the shared backend passed 25 desktop scenarios in the original theme and
25 in the OpenCode theme on Windows 10.0.26200, Node 24.19.0, 2560 by 1440 at 96 DPI.
The OpenCode adapter also completed a real model fixture task with OpenCode 1.18.25 before
packaging. The release export has additional unit and installation checks.

Version 1.3.2 passed 68 unit checks and 26 desktop scenarios in each theme. These desktop runs
used the new five second default and separately checked a configured one second announcement.
Configuration tests also cover the saved OpenCode duration, reinstall preservation, invalid values,
CLI precedence and cleanup despite invalid settings. The earlier baseline remains historical.

Version 1.4.0 passed 77 unit checks and 30 desktop scenarios in each theme. The added desktop
checks confirm exact Unicode/whitespace through UIA, bounded values, password redaction,
read-only/toggle state, disabled exact-name refusal and conditional readiness without input.
Pure checks cover cancellation, invalid/late observations, startup deadlines and disabled MCP settings.

The natural-language task also passed with the same standard OpenCode model and variant: 9 calls,
zero screenshots, one typing call, no tool refusals and released control. The model requested a
detailed field read after typing; the tool returned the exact complete expected value. The fixture
independently confirmed the actual text. The previous task used one screenshot. This is a scoped
example of replacing an image with semantic evidence, not a measured token or cost reduction.
Other projects were reviewed at pinned commits in the
[alternatives review](opencode-alternatives-2026-10-18.md); they were not run as competing systems.

After the guidance update, `opencode/deepseek-v4.1-flash-free` with variant `low` completed the
natural-language fixture task without tool names in the user prompt: 9 tool calls, one screenshot,
one typing call, no tool refusals, the exact full field value and released control. The model
loaded the skill, found and focused the window, used UIA and a named target, then checked the image.
The compact instruction and skill catalog also reached a loopback model fixture automatically.
Earlier Nemotron natural-task runs did not pass: one selected coordinates without confirming
focus and the other timed out. They are not included as successful runs. These results show why
the input target guard and independent fixture check are required.

These are scoped observations. They do not prove zero failures in every app or a higher task
success rate than UI-TARS. A useful comparison needs identical tasks, independent application
state checks, repeated attempts and separate reporting of model, environment, time and cost.

## Documentation review

Antislop writing review: PASS. The package guides are English, use working relative links,
state prerequisites next to commands, preserve provider choice and distinguish code checks
from desktop or live model tests. The package adds no new product interface or visual assets.

## Independent OpenCode repository: October 19, 2026

Version 1.4.0 is maintained in
[datuloar/open-code-computer-use-win](https://github.com/datuloar/open-code-computer-use-win),
with its own Git history, source, installer and release workflow. It does not load source from a
DeepSeek Harness checkout. The installer supports an explicit `-MigrateFrom <previous-checkout>`
with backups and preserves providers, model, countdown, enabled state, timeout and other servers.

After migration, actual OpenCode reported `computer` connected and discovered
`opencode-computer-use`. Unit checks passed 78/78. The isolated OpenCode-theme desktop suite
passed 30/30. The [raw report](https://github.com/datuloar/open-code-computer-use-win/blob/main/docs/benchmarks/2026-10-19-v1.4.0-opencode.json)
records source SHA256 `d1bc22067a7ec1acef6fbca04297b825dc623b6705549651d5b0474f63854297`.

The first desktop attempt passed 28 checks, then refused a target covered by another window.
Its failed report was retained. An uninterrupted repeat passed without changing the assertions
or the input guards. Physical ESC, UAC/elevated input and additional monitors remain separate checks.

The actual OpenCode loopback integration test passed after the move: automatic instructions, skill
discovery and all seven guidance checks were true; the plugin released desktop control before
the ordinary file read. A natural-language task through `opencode/deepseek-v4.1-flash-free`, variant
`low`, passed with nine completed tool calls, one typing call, zero refusals, zero screenshots,
exact full-value verification through UIA and released control. The fixture independently checked
the exact contents. See the [sanitized live summary](https://github.com/datuloar/open-code-computer-use-win/blob/main/docs/benchmarks/2026-10-19-v1.4.0-live.json).

The previously selected Nemotron model reached the expected final text but failed the strict
single-typing-call requirement. It also attempted a disallowed coordinate click and ordinary
file searches. The failed trace remains local and is not counted as a pass. The tested DeepSeek
model was selected for this user's installation; the distributed installer still preserves other
users' provider and model choices unless they explicitly pass `-Model`.
