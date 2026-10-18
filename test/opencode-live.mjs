import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { humanStopSeconds, indicatorIsUp, root, sleep } from '../src/backend.js';

assert.ok(!indicatorIsUp(), 'stop the current computer-use session before this test');
assert.ok(humanStopSeconds() >= 600, 'physical ESC recently stopped control; this test will not resume it');
const folder = mkdtempSync(join(tmpdir(), 'dsh-cu-opencode-live-'));
console.log(`live test artifacts: ${folder}`);
const fixture = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'test', 'desktop-fixture.ps1'), folder], {
  stdio: 'ignore', windowsHide: true,
});
let runner = null;
let timer = null;
try {
  const deadline = Date.now() + 20000;
  while (!existsSync(join(folder, 'ready.json'))) {
    if (Date.now() >= deadline || fixture.exitCode !== null) throw new Error('the isolated test window did not start');
    await sleep(50);
  }
  const target = JSON.parse(readFileSync(join(folder, 'ready.json'), 'utf8'));
  const model = process.argv[2] || 'opencode/nemotron-3.5-super-vl-free';
  const binary = process.argv[3] || join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  const expected = 'OpenCode verified';
  const prompt = `Test the installed computer-use integration only in the isolated fixture window with pid ${target.pid}, title "${target.title}". `
    + `Load skill opencode-computer-use. Use computer_windows to obtain this window's rectangle. Use computer_focus for this pid, inspect computer_ui_tree for this pid, `
    + `then computer_tap the unique control Test editor in this pid. Use computer_type once to enter exactly ${JSON.stringify(expected)}. `
    + 'Read the resulting state using a screenshot of the entire fixture rectangle obtained from computer_windows, and verify the exact text with no extra or duplicate characters. Stop the indicator, then reply briefly in Russian. '
    + 'Do not interact with any other window, use the clipboard, or run shell commands. If any step fails, stop and report the failure.';
  runner = spawn(binary, ['run', '--format', 'json', '--model', model, '--title', 'Computer-use live fixture', '--dir', root, prompt], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { unityMCP: { enabled: false } } }) },
  });
  let stdout = '';
  let stderr = '';
  runner.stdout.on('data', (chunk) => { stdout += chunk; });
  runner.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); });
  timer = setTimeout(() => runner.kill(), 180000);
  const code = await new Promise((resolve, reject) => { runner.once('exit', resolve); runner.once('error', reject); });
  writeFileSync(join(folder, 'events.jsonl'), stdout);
  writeFileSync(join(folder, 'stderr.txt'), stderr);
  assert.equal(code, 0, stderr);
  const actual = existsSync(join(folder, 'text.txt')) ? readFileSync(join(folder, 'text.txt'), 'utf8').replaceAll('\r', '') : '';
  assert.equal(actual, expected, 'the real fixture must receive the requested text exactly');
  for (let attempt = 0; attempt < 60 && indicatorIsUp(); attempt++) await sleep(50);
  assert.ok(!indicatorIsUp(), 'OpenCode must release desktop control before completing');
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const tools = events.filter((event) => event.type === 'tool_use').map((event) => ({ name: event.part.tool, status: event.part.state.status }));
  for (const name of ['computer_focus', 'computer_ui_tree', 'computer_tap', 'computer_type', 'computer_screenshot'])
    assert.ok(tools.some((tool) => tool.name === name && tool.status === 'completed'), name);
  assert.deepEqual(events.filter((event) => event.type === 'error'), []);
  const report = { passed: true, model, typed: actual, tools, controlStopped: true, artifacts: folder };
  writeFileSync(join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (timer) clearTimeout(timer);
  if (runner && runner.exitCode === null) runner.kill();
  writeFileSync(join(folder, 'stop'), 'stop');
  await sleep(300);
  if (fixture.exitCode === null) fixture.kill();
}
