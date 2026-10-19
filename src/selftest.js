import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { release, tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { checkContract } from './contract.js';
import { indicatorIsUp, humanStopSeconds } from './backend.js';
import { DEFAULT_ANNOUNCE_SECONDS } from './settings.js';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(50);
  }
  throw new Error('timed out waiting for the test fixture');
}

function sourceFingerprint(root) {
  const hash = createHash('sha256');
  const visit = (relative) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:js|mjs|ps1|cs)$/.test(entry.name)) hash.update(`${path}\0`).update(readFileSync(join(root, path)));
    }
  };
  for (const directory of ['src', 'backends', 'lib', 'test', 'opencode']) visit(directory);
  return hash.update(readFileSync(join(root, 'package.json'))).digest('hex');
}

export async function runSelfTest({ root, cli, exec }) {
  assert.equal(process.platform, 'win32', 'interactive self-test requires Windows');
  assert.ok(!indicatorIsUp(), 'stop the current computer-use session before self-test');
  assert.ok(humanStopSeconds() >= 600, 'the human pressed ESC recently; self-test will not restart control');
  const folder = mkdtempSync(join(tmpdir(), 'dsh-cu-test-'));
  const started = performance.now();
  const reportPath = join(folder, 'report.json');
  const report = {
    schemaVersion: 1,
    suite: 'dsh-cu-desktop',
    status: 'running',
    startedAt: new Date().toISOString(),
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    sourceSha256: sourceFingerprint(root),
    environment: { platform: process.platform, osRelease: release(), arch: process.arch, node: process.version,
      theme: process.env.DSH_CU_THEME === 'opencode' ? 'opencode' : 'deepseek', announceSeconds: DEFAULT_ANNOUNCE_SECONDS },
    checks: [],
  };
  const saveReport = () => {
    writeFileSync(`${reportPath}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(`${reportPath}.tmp`, reportPath);
  };
  saveReport();
  let fixtureSequence = 0;
  const fixtureCommand = async (action) => {
    const id = ++fixtureSequence;
    writeFileSync(join(folder, 'request.tmp'), JSON.stringify({ id, action }));
    renameSync(join(folder, 'request.tmp'), join(folder, 'request.json'));
    let reply;
    await until(() => {
      try { reply = JSON.parse(readFileSync(join(folder, 'response.json'), 'utf8')); }
      catch { return false; }
      return reply.id === id;
    });
    assert.ok(!reply.error, reply.error);
    return reply;
  };
  const testOwner = `selftest:${process.pid}`;
  const state = (name) => join(tmpdir(), `dsh-cu.${name}`);
  const testEnvironment = { DSH_CU_OWNER: testOwner, DSH_CU_ANNOUNCE_SECONDS: String(DEFAULT_ANNOUNCE_SECONDS) };
  const callCli = (args) => exec(process.execPath, [cli, ...args], testEnvironment);
  const fixture = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'test', 'desktop-fixture.ps1'), folder], { stdio: 'ignore', windowsHide: true });
  let fixtureError;
  fixture.on('error', (error) => { fixtureError = error; });
  const server = spawn(process.execPath, [cli, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, ...testEnvironment } });
  let sequence = 0;
  let buffer = '';
  let serverError;
  const pending = new Map();
  const failServer = (error) => {
    serverError = error;
    for (const resolve of [...pending.values()]) resolve({ error: { message: error.message } });
  };
  server.on('error', failServer);
  server.stdin.on('error', failServer);
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const reply = JSON.parse(line);
        pending.get(reply.id)?.(reply);
      } catch {
        for (const resolve of pending.values()) resolve({ error: { message: `invalid protocol output: ${line}` } });
      }
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (serverError) { reject(serverError); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 60000);
    pending.set(id, (reply) => { clearTimeout(timer); pending.delete(id); resolve(reply); });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name, args = {}, error = false) => {
    const reply = await rpc('tools/call', { name, arguments: args });
    assert.ok(reply.result, JSON.stringify(reply.error));
    const text = reply.result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    assert.equal(Boolean(reply.result.isError), error, text);
    return text;
  };
  let passed = 0;
  const check = async (name, action) => {
    const checkStarted = performance.now();
    const result = { id: name.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase(), name, status: 'failed' };
    try {
      assert.ok(humanStopSeconds() >= 600, 'the human pressed ESC; self-test stops here');
      const value = await action();
      const detail = typeof value === 'string' ? value : value?.detail;
      if (detail) result.detail = detail;
      if (value?.metrics) result.metrics = value.metrics;
      result.status = 'passed';
      passed++;
      console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (error) {
      result.error = error.message;
      throw error;
    } finally {
      result.durationMs = Math.round(performance.now() - checkStarted);
      report.checks.push(result);
      saveReport();
    }
  };
  console.log(`self-test: isolated workspace ${folder}`);
  try {
    await until(() => {
      if (fixtureError) throw fixtureError;
      if (fixture.exitCode !== null) throw new Error(`the fixture exited before becoming ready (${fixture.exitCode})`);
      return existsSync(join(folder, 'ready.json'));
    });
    const target = JSON.parse(readFileSync(join(folder, 'ready.json'), 'utf8'));
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.serverInfo.name, process.env.DSH_CU_THEME === 'opencode' ? 'opencode-computer-use' : 'dsh-cu');
    await check('documentation and command surface agree', () => assert.deepEqual(checkContract(root), []));
    await check('input and focus refuse before the indicator starts', () => {
      for (const args of [['move', '100', '100'], ['focus', String(target.pid)]]) assert.throws(() => callCli(args), /indicator is not running/);
    });
    await check('invalid MCP arguments never start the indicator', async () => {
      assert.match(await tool('type', {}, true), /text is required/);
      assert.match(await tool('click', { x: 99999, y: 0 }, true), /32767/);
      assert.ok(!indicatorIsUp());
    });
    await check('MCP focus starts a countdown and blocks concurrent input', async () => {
      const start = Date.now();
      const focusing = tool('focus', { pid: target.pid });
      await until(() => existsSync(state('alive')));
      assert.ok(!existsSync(state('ready')));
      assert.throws(() => callCli(['move', '100', '100']), /countdown/);
      assert.throws(() => exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'backends', 'windows.ps1'), 'move', '100', '100']), /countdown/);
      await focusing;
      assert.ok(Date.now() - start >= DEFAULT_ANNOUNCE_SECONDS * 1000);
      assert.ok(existsSync(state('ready')));
      assert.ok(!existsSync(state('cursor')));
      const elapsed = Date.now() - start;
      return { detail: `${elapsed} ms including cold startup`, metrics: { coldStartWithCountdownMs: elapsed } };
    });
    await check('warm backend reads controls and recovers after an error', async () => {
      assert.match(await tool('ui_tree', { pid: target.pid }), /Test editor/);
      await tool('ui_tree', { pid: 2147483647 }, true);
      const start = Date.now();
      assert.match(await tool('ui_tree', { pid: target.pid }), /Test action/);
      const elapsed = Date.now() - start;
      return { detail: `${elapsed} ms for the warm tree`, metrics: { warmTreeMs: elapsed } };
    });
    await check('off-screen move and drag fail before changing the pointer', async () => {
      const display = /DISPLAY (\d+)x(\d+)/.exec(callCli(['display']));
      assert.ok(display);
      report.environment.display = { width: Number(display[1]), height: Number(display[2]) };
      const x = Number(display[1]);
      const before = callCli(['pos']).split('\n')[0];
      assert.match(await tool('move', { x, y: 100 }, true), /outside the primary screen/);
      assert.match(await tool('drag', { x: 100, y: 100, to_x: x, to_y: 100 }, true), /outside the primary screen/);
      assert.equal(callCli(['pos']).split('\n')[0], before);
    });
    let clipboardSequence;
    await check('typing preserves Unicode, whitespace, tabs and newlines', async () => {
      clipboardSequence = (await fixtureCommand('clipboard')).sequence;
      assert.ok(clipboardSequence > 0, 'the clipboard sequence number is unavailable');
      await tool('tap', { pid: target.pid, text: 'Test editor' });
      const text = '  Привет "Minecraft" 😀\tmods\nsecond line  ';
      await tool('type', { text });
      await until(() => {
        try { return readFileSync(join(folder, 'text.txt'), 'utf8').replaceAll('\r', '') === text; }
        catch { return false; }
      });
      assert.equal(readFileSync(join(folder, 'text.txt'), 'utf8').replaceAll('\r', ''), text);
      assert.match(readFileSync(state('action'), 'utf8'), /^type \d+ chars$/);
    });
    await check('typing leaves the clipboard sequence unchanged', async () => {
      assert.equal((await fixtureCommand('clipboard')).sequence, clipboardSequence);
    });
    await check('UIA inspection verifies the complete typed value without OCR', async () => {
      const observed = JSON.parse((await tool('find', { pid: target.pid, text: 'Test editor', details: true })).split('\n')[0]);
      assert.equal(observed.valueStatus, 'available');
      assert.equal(observed.truncated, false);
      assert.equal(observed.value.replaceAll('\r', ''), readFileSync(join(folder, 'text.txt'), 'utf8').replaceAll('\r', ''));
    });
    await check('tap refuses a disabled exact target instead of its enabled substring', async () => {
      assert.match(await tool('tap', { pid: target.pid, text: 'Delayed control' }, true), /named control is disabled/);
      assert.ok(!existsSync(join(folder, 'wrong-delayed-click.txt')));
    });
    await check('a named button click reaches the fixture', async () => {
      await tool('tap', { pid: target.pid, text: 'Test action' });
      await until(() => existsSync(join(folder, 'clicked.txt')));
    });
    await check('tap considers exact duplicates beyond its displayed candidate limit', async () => {
      assert.match(await tool('tap', { pid: target.pid, text: 'Ambiguous target' }, true), /2 controls match/);
    });
    await check('tap refuses a covered target without clicking the covering window', async () => {
      try {
        await fixtureCommand('cover');
        assert.match(await tool('tap', { window: target.title, text: 'Test action' }, true), /covered by another window/);
        assert.ok(!existsSync(join(folder, 'decoy-clicked.txt')));
      } finally {
        await fixtureCommand('uncover');
      }
      await tool('focus', { pid: target.pid });
    });
    await check('typed flag names and whitespace remain literal text', async () => {
      await tool('tap', { pid: target.pid, text: 'Test editor' });
      await tool('press', { keys: 'ctrl+End' });
      await tool('type', { text: '-Quiet' });
      await tool('type', { text: '  ' });
      await until(() => readFileSync(join(folder, 'text.txt'), 'utf8').endsWith('-Quiet  '));
    });
    await check('screenshot returns PNG pixels', async () => {
      const display = /DISPLAY (\d+)x(\d+)/.exec(callCli(['display']));
      assert.ok(display);
      const width = Math.min(1800, Number(display[1]));
      const height = Math.min(150, Number(display[2]));
      const x = Math.floor((Number(display[1]) - width) / 2);
      const result = await rpc('tools/call', { name: 'screenshot', arguments: { x, y: 0, width, height } });
      assert.ok(!result.result.isError);
      const data = Buffer.from(result.result.content.find((item) => item.type === 'image').data, 'base64');
      assert.equal(data.readUInt32BE(16), width);
      assert.equal(data.readUInt32BE(20), height);
      writeFileSync(join(folder, 'indicator.png'), data);
    });
    await check('invalid key combinations release held modifiers', async () => {
      await tool('tap', { pid: target.pid, text: 'Test editor' });
      await tool('press', { keys: 'ctrl+NotAKey' }, true);
      await tool('press', { keys: 'End' });
      await tool('type', { text: 'z' });
      await until(() => readFileSync(join(folder, 'text.txt'), 'utf8').endsWith('  z'));
      assert.ok(readFileSync(join(folder, 'text.txt'), 'utf8').endsWith('  z'));
    });
    await check('stop removes state and leaves the cursor alone', async () => {
      await tool('indicator', { action: 'stop' });
      for (const name of ['alive', 'pid', 'ready', 'cursor', 'owner']) assert.ok(!existsSync(state(name)), name);
    });
    await check('key releases still work after control stops', () => {
      assert.match(callCli(['key', 'Ctrl', 'up']), /KEY Ctrl up/);
    });
    await check('read-only inspection bounds values and hides password fields without starting control', async () => {
      const inspect = async (text, extra = {}) => JSON.parse((await tool('find', { pid: target.pid, text, details: true, ...extra })).split('\n')[0]);
      const value = await inspect('Test value');
      assert.equal(value.value, '  sample "value" \\path  ');
      assert.equal(value.readOnly, true);
      assert.equal(value.truncated, false);
      const shortened = await inspect('Test value', { max_chars: 5 });
      assert.equal(shortened.value, value.value.slice(0, 5));
      assert.equal(shortened.truncated, true);
      const password = await inspect('Test password');
      assert.equal(password.valueStatus, 'protected');
      assert.equal(password.value, null);
      assert.equal((await inspect('Test toggle')).toggle, 'On');
      assert.equal((await inspect('Missing fixture field')).found, false);
      assert.match(await tool('find', { pid: target.pid, text: 'Ambiguous target', details: true }, true), /2 controls match/);
      assert.ok(!indicatorIsUp());
    });
    await check('conditional waiting observes readiness without moving the pointer or starting control', async () => {
      await fixtureCommand('delay-control');
      const before = callCli(['pos']).split('\n')[0];
      const waiting = JSON.parse((await tool('wait', { pid: target.pid, text: 'Delayed control', seconds: 5 })).split('\n')[0]);
      assert.equal(waiting.condition, 'enabled');
      assert.equal(waiting.observation.control.enabled, true);
      assert.equal(callCli(['pos']).split('\n')[0], before);
      assert.ok(!indicatorIsUp());
      assert.match(await tool('wait', { pid: target.pid, text: 'Missing fixture field', seconds: 0.5 }, true), /timed out/);
      return { metrics: { waitChecks: waiting.checks, waitForReadyMs: waiting.waitedMs } };
    });
    await check('a configured one second countdown completes before control is ready', () => {
      const start = Date.now();
      const result = exec(process.execPath, [cli, 'overlay'], { ...testEnvironment, DSH_CU_ANNOUNCE_SECONDS: '1' });
      assert.match(result, /announced for 1s/);
      assert.ok(Date.now() - start >= 1000);
      assert.ok(existsSync(state('ready')));
      const elapsed = Date.now() - start;
      callCli(['overlay', '--stop']);
      assert.ok(!indicatorIsUp());
      return { metrics: { configuredSeconds: 1, startupWithCountdownMs: elapsed } };
    });
    await check('stopping during the countdown never reports control ready', async () => {
      const starting = tool('indicator', { action: 'start' }, true);
      await until(() => existsSync(state('alive')));
      writeFileSync(state('stop'), 'self-test');
      assert.match(await starting, /stopped during the announcement/);
      assert.ok(!existsSync(state('ready')));
    });
    await check('cancelling indicator startup leaves no late indicator behind', async () => {
      const starting = tool('indicator', { action: 'start' }, true);
      const requestId = sequence;
      await sleep(100);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } })}\n`);
      await starting;
      await until(() => !existsSync(state('pid')) && !existsSync(state('alive')));
      await sleep(300);
      assert.ok(!indicatorIsUp());
    });
    await check('a stop interrupts text within the current chunk', async () => {
      callCli(['overlay', '--announce', '0']);
      await tool('focus', { pid: target.pid });
      await tool('tap', { pid: target.pid, text: 'Test editor' });
      await tool('press', { keys: 'ctrl+End' });
      const before = readFileSync(join(folder, 'text.txt'), 'utf8').length;
      const typing = tool('type', { text: 'x'.repeat(1200) }, true);
      await until(() => readFileSync(join(folder, 'text.txt'), 'utf8').length >= before + 5);
      const stoppedAt = Date.now();
      writeFileSync(state('stop'), 'self-test');
      assert.match(await typing, /typing stopped after \d+ of \d+ chars/);
      const elapsed = Date.now() - stoppedAt;
      assert.ok(elapsed < 2000, `stop took ${elapsed} ms`);
      assert.ok(readFileSync(join(folder, 'text.txt'), 'utf8').length < before + 200);
      return { detail: `${elapsed} ms from stop request to MCP refusal`, metrics: { stopToRefusalMs: elapsed } };
    });
    await check('MCP cancellation interrupts input and releases the desktop', async () => {
      callCli(['overlay', '--announce', '0']);
      await tool('focus', { pid: target.pid });
      await tool('tap', { pid: target.pid, text: 'Test editor' });
      await tool('press', { keys: 'ctrl+End' });
      const before = readFileSync(join(folder, 'text.txt'), 'utf8').length;
      const typing = tool('type', { text: 'c'.repeat(1200) }, true);
      const requestId = sequence;
      await until(() => readFileSync(join(folder, 'text.txt'), 'utf8').length >= before + 5);
      const cancelledAt = Date.now();
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } })}\n`);
      await typing;
      await until(() => !existsSync(state('pid')));
      const elapsed = Date.now() - cancelledAt;
      assert.ok(elapsed < 2000);
      assert.ok(readFileSync(join(folder, 'text.txt'), 'utf8').length < before + 200);
      return { detail: `${elapsed} ms from cancellation to cleanup`, metrics: { cancelToCleanupMs: elapsed } };
    });
    await check('cursor replacement is opt-in and restored on stop', async () => {
      callCli(['overlay', '--announce', '0', '--hide-cursor']);
      assert.ok(existsSync(state('cursor')));
      callCli(['overlay', '--stop']);
      assert.ok(!existsSync(state('cursor')));
    });
    await check('killing an indicator refuses input and repairs its hidden cursor', async () => {
      callCli(['overlay', '--announce', '0', '--hide-cursor']);
      const owner = Number(readFileSync(state('pid'), 'utf8').split(' ')[0]);
      process.kill(owner);
      await sleep(150);
      assert.throws(() => callCli(['move', '100', '100']), /indicator is not running/);
      assert.ok(!existsSync(state('cursor')));
    });
    await check('a stale pid record cannot kill the fixture', () => {
      writeFileSync(state('pid'), `${target.pid} 1`);
      callCli(['overlay', '--stop']);
      process.kill(target.pid, 0);
    });
    await check('another MCP client cannot take or stop this desktop session', async () => {
      callCli(['overlay', '--announce', '0']);
      const owner = readFileSync(state('pid'), 'utf8');
      assert.throws(() => exec(process.execPath, [cli, 'overlay', '--announce', '0'], { DSH_CU_OWNER: 'foreign:test' }), /another computer-use client/);
      assert.throws(() => exec(process.execPath, [cli, 'overlay', '--stop'], { DSH_CU_OWNER: 'foreign:test' }), /another computer-use client/);
      assert.throws(() => exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'backends', 'windows.ps1'),
        'overlay', '-Announce', '0'], { DSH_CU_OWNER: 'foreign:test' }), /another computer-use client/);
      assert.equal(readFileSync(state('pid'), 'utf8'), owner);
      writeFileSync(state('stop'), 'owner foreign:test');
      await sleep(150);
      assert.equal(readFileSync(state('pid'), 'utf8'), owner);
      await tool('tap', { pid: target.pid, text: 'Test editor' });
      callCli(['overlay', '--stop']);
    });
    await check('MCP disconnect stops its owned indicator', async () => {
      callCli(['overlay', '--announce', '0']);
      server.stdin.end();
      await until(() => !existsSync(state('pid')) && !existsSync(state('alive')));
    });
    console.log(`${passed}/${passed} checks passed; artifacts: ${folder}`);
    console.log('Physical ESC and model decision quality require a separate interactive check.');
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    try {
      writeFileSync(join(folder, 'stop'), 'stop');
      try { callCli(['overlay', '--stop']); } finally { server.stdin.end(); server.kill(); }
      await sleep(300);
      if (fixture.exitCode === null) fixture.kill();
    } catch (error) {
      report.error ??= error.message;
      throw error;
    } finally {
      report.status = report.error ? 'failed' : 'passed';
      report.finishedAt = new Date().toISOString();
      report.durationMs = Math.round(performance.now() - started);
      report.summary = { passed, failed: report.checks.filter((result) => result.status === 'failed').length };
      saveReport();
      console.log(`JSON report: ${reportPath}`);
    }
  }
}
