import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { humanStopSeconds, indicatorIsUp, indicatorOwner, requestIndicatorStop, root, sleep } from '../src/backend.js';

assert.ok(!indicatorIsUp(), 'stop the current computer-use session before this test');
assert.ok(humanStopSeconds() >= 600, 'physical ESC recently stopped control; this test will not resume it');
const folder = mkdtempSync(join(tmpdir(), 'opencode-cu-opencode-live-'));
console.log(`live test artifacts: ${folder}`);
const fixture = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'test', 'desktop-fixture.ps1'), folder], {
  stdio: 'ignore', windowsHide: true,
});
let runner = null;
let timer = null;
let controlOwner = '';
let timedOut = false;
try {
  const deadline = Date.now() + 20000;
  while (!existsSync(join(folder, 'ready.json'))) {
    if (Date.now() >= deadline || fixture.exitCode !== null) throw new Error('the isolated test window did not start');
    await sleep(50);
  }
  const target = JSON.parse(readFileSync(join(folder, 'ready.json'), 'utf8'));
  const rawArgs = process.argv.slice(2);
  const args = [];
  let variant;
  for (let index = 0; index < rawArgs.length; index++) {
    if (rawArgs[index] === '--natural') continue;
    if (rawArgs[index] === '--variant') {
      variant = rawArgs[++index];
      if (!variant || variant.startsWith('--')) throw new Error('--variant needs a supported model variant');
    } else args.push(rawArgs[index]);
  }
  const model = args[0] || 'opencode/deepseek-v4.1-flash-free';
  const binary = args[1] || join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  const expected = 'OpenCode verified';
  const naturalTask = process.argv.includes('--natural');
  const prompt = naturalTask
    ? `In the Windows test window titled "${target.title}", replace the Test editor field with exactly ${JSON.stringify(expected)}. `
      + 'Use the installed desktop integration, check that the entire field contains the requested value with no extra characters, then return control and report briefly in English. '
      + 'Do not submit anything or interact with any other window. Do not use the clipboard or shell. If you cannot complete it, stop and explain.'
    : `Test the installed computer-use integration only in the isolated fixture window with pid ${target.pid}, title "${target.title}". `
    + `Load skill opencode-computer-use. Use computer_windows to obtain this window's rectangle. Use computer_focus for this pid, inspect computer_ui_tree for this pid, `
    + `then computer_tap the unique control Test editor in this pid. Use computer_type once to enter exactly ${JSON.stringify(expected)}. `
    + 'Verify the entire field with computer_find using details:true and this pid; require valueStatus available and truncated false. Use a cropped screenshot only if UIA cannot read the value. Stop the indicator, then reply briefly in English. '
    + 'Do not interact with any other window, use the clipboard, or run shell commands. If any step fails, stop and report the failure.';
  runner = spawn(binary, ['run', '--format', 'json', '--model', model, ...(variant ? ['--variant', variant] : []), '--title', 'Computer-use live fixture', '--dir', root, prompt], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { unityMCP: { enabled: false } },
      permission: { 'computer_*': 'allow', skill: { 'opencode-computer-use': 'allow' } },
      plugin: [[pathToFileURL(join(root, 'test/opencode-fixture-guard.js')).href, { pid: target.pid, title: target.title }]] }) },
  });
  let stdout = '';
  let stderr = '';
  runner.stdout.on('data', (chunk) => {
    stdout += chunk;
    writeFileSync(join(folder, 'events.jsonl'), stdout);
    if (!controlOwner && indicatorOwner().startsWith('opencode:')) controlOwner = indicatorOwner();
  });
  runner.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); writeFileSync(join(folder, 'stderr.txt'), stderr); });
  timer = setTimeout(() => { timedOut = true; runner.kill(); }, naturalTask ? 300000 : 180000);
  const code = await new Promise((resolve, reject) => { runner.once('exit', resolve); runner.once('error', reject); });
  writeFileSync(join(folder, 'events.jsonl'), stdout);
  writeFileSync(join(folder, 'stderr.txt'), stderr);
  assert.ok(!timedOut, 'live model did not complete within the test time budget');
  assert.equal(code, 0, stderr);
  const actual = existsSync(join(folder, 'text.txt')) ? readFileSync(join(folder, 'text.txt'), 'utf8').replaceAll('\r', '') : '';
  assert.equal(actual, expected, 'the real fixture must receive the requested text exactly');
  for (let attempt = 0; attempt < 60 && indicatorIsUp(); attempt++) await sleep(50);
  assert.ok(!indicatorIsUp(), 'OpenCode must release desktop control before completing');
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const toolEvents = events.filter((event) => event.type === 'tool_use');
  const tools = toolEvents.map((event) => ({ name: event.part.tool, status: event.part.state.status }));
  const typingIndex = tools.findIndex((tool) => tool.name === 'computer_type');
  const semanticVerification = toolEvents.slice(typingIndex + 1).some((event) => {
    const { tool, state } = event.part;
    if (tool !== 'computer_find' || state.status !== 'completed' || state.input?.details !== true
      || (state.input.pid !== target.pid && state.input.window !== target.title) || state.input.text !== 'Test editor') return false;
    try {
      const observed = JSON.parse(state.output.split('\n')[0]);
      return observed.valueStatus === 'available' && observed.truncated === false && observed.value === expected;
    } catch { return false; }
  });
  const visualVerification = tools.slice(typingIndex + 1).some((tool) =>
    ['computer_screenshot', 'computer_read_text'].includes(tool.name) && tool.status === 'completed');
  if (!naturalTask) assert.ok(tools.every((tool) => tool.status === 'completed'), JSON.stringify(tools));
  if (naturalTask) {
    assert.ok(tools.some((tool) => tool.name === 'computer_windows'), 'the model must discover the target');
    assert.ok(tools.some((tool) => ['computer_ui_tree', 'computer_find'].includes(tool.name)), 'prefer UIA before visual fallback');
    assert.equal(tools.filter((tool) => tool.name === 'computer_type').length, 1, 'type once, without a duplicate replay');
    assert.ok(semanticVerification || visualVerification, 'verify the complete field through UIA or visible evidence');
    const firstInput = tools.findIndex((tool) => ['computer_focus', 'computer_tap', 'computer_click', 'computer_type', 'computer_press'].includes(tool.name));
    assert.ok(tools.slice(0, firstInput).some((tool) => tool.name === 'skill'), 'load the skill before desktop input');
  } else {
    for (const name of ['computer_focus', 'computer_ui_tree', 'computer_tap', 'computer_type'])
      assert.ok(tools.some((tool) => tool.name === name), name);
    assert.ok(semanticVerification || visualVerification, 'verify the complete field through UIA or visible evidence');
  }
  assert.deepEqual(events.filter((event) => event.type === 'error'), []);
  const report = { passed: true, model, variant, naturalTask, typed: actual, tools, toolCalls: tools.length, semanticVerification,
    refusedToolCalls: tools.filter((tool) => tool.status === 'error').length,
    screenshotCalls: tools.filter((tool) => tool.name === 'computer_screenshot').length, controlStopped: true, artifacts: folder };
  writeFileSync(join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(folder, 'report.json'), JSON.stringify({ passed: false, error: error.message, timedOut, artifacts: folder }, null, 2));
  throw error;
} finally {
  if (timer) clearTimeout(timer);
  if (runner && runner.exitCode === null) runner.kill();
  if (controlOwner) {
    requestIndicatorStop(controlOwner);
    for (let attempt = 0; attempt < 60 && indicatorOwner() === controlOwner; attempt++) await sleep(50);
  }
  writeFileSync(join(folder, 'stop'), 'stop');
  await sleep(300);
  if (fixture.exitCode === null) fixture.kill();
}
