# OpenCode Validation

Version 1.0.0 uses the native OpenCode package entry, the `opencode-cu` CLI,
`OPENCODE_CU_*` settings and its own Windows state and backend protocol.
The OpenCode theme is the default for every entry point.

## Run the checks

```powershell
node src/verify.js
node test/run.mjs
node src/cli.js self-test
node test/opencode-smoke.mjs
```

Static and unit checks do not inject input. The desktop suite uses only its dedicated fixture
and preserves a report with numeric timings and the tested source fingerprint. The smoke test
uses an isolated OpenCode configuration and a loopback model fixture. A live model task requires
authorized provider usage and a visible fixture window.

Physical ESC, elevated input, secure desktop and additional monitors are separate checks.
Source comparisons do not establish task win rates against other products.

## Initial release results: October 19, 2026

- Static native package, skill and CLI contract: passed.
- Unit checks: 77 passed, zero failures.
- Isolated Windows desktop checks: 30 passed, zero failures.
- Actual OpenCode loopback integration: all four tool steps completed, automatic instructions
  loaded, all seven guidance checks passed, and control stopped before the ordinary file read.
- Installed `computer` MCP entry: connected; `opencode-computer-use` skill: installed.

The [desktop report](https://github.com/datuloar/open-code-computer-use-win/blob/main/docs/benchmarks/2026-10-19-v1.0.0-opencode.json)
records source SHA256 `b6826b8a7999ded3725050d7aad76d9c1a70ab92be2509b75c7fe15356ef0b6b`.
The [OpenCode integration report](https://github.com/datuloar/open-code-computer-use-win/blob/main/docs/benchmarks/2026-10-19-v1.0.0-smoke.json)
contains the tool and guidance outcomes without the local artifact path.

Two initial desktop attempts stopped because the pointer moved during the read-only wait check.
Their failed reports remain in the test temp directories. The uninterrupted repeat passed without
source changes or weakened assertions. The loopback fixture verifies tool integration and guidance;
it does not measure a provider model's success rate on arbitrary desktop tasks.
