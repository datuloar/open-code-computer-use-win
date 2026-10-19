import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { humanStopSeconds, indicatorIsUp, indicatorOwner, requestIndicatorStop, root } from '../src/backend.js';
import { installOpenCode } from '../src/install-opencode.js';

assert.ok(!indicatorIsUp(), 'stop the current computer-use session before this test');
assert.ok(humanStopSeconds() >= 600, 'physical ESC recently stopped control; this test will not resume it');
const folder = mkdtempSync(join(tmpdir(), 'opencode-cu-opencode-smoke-'));
const configDir = join(folder, 'config', 'opencode');
const installed = installOpenCode({ configDir, configPath: join(configDir, 'opencode.json') });
console.log(`OpenCode smoke artifacts: ${folder}`);
const actions = [
  ['skill', { name: 'opencode-computer-use' }],
  ['computer_windows', {}],
  ['computer_indicator', { action: 'start', hide_cursor: false }],
  ['read', { filePath: join(root, 'package.json'), offset: 1, limit: 5 }],
];
let step = 0;
let owner = '';
let instructionsLoaded = false;
const guidance = { toolChoice: false, smallObservations: false, inputVerification: false, sessionEfficiency: false,
  skillDiscovery: false, semanticVerification: false, conditionalReadiness: false };
let stoppedBeforeFinal = false;
let serverError = null;
const server = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const isMain = input.tools?.some((tool) => tool.function?.name === 'computer_indicator');
    let action = null;
    if (isMain) {
      const system = JSON.stringify(input.messages.filter((message) => ['system', 'developer'].includes(message.role)));
      writeFileSync(join(folder, 'tools.json'), JSON.stringify(input.tools, null, 2));
      instructionsLoaded ||= system.includes('Windows desktop control in OpenCode');
      guidance.toolChoice ||= system.includes('Use file and shell tools for code') && system.includes('computer_find');
      guidance.smallObservations ||= system.includes('Do not take a full') && system.includes('observed window bounds');
      guidance.inputVerification ||= system.includes('extra/duplicate characters') && system.includes('before retrying');
      guidance.semanticVerification ||= system.includes('details: true') && system.includes('valueStatus') && system.includes('truncated');
      guidance.conditionalReadiness ||= system.includes('conditional readiness') && system.includes('polls without input');
      guidance.sessionEfficiency ||= system.includes('do not stop/restart after every click');
      guidance.skillDiscovery ||= input.tools.some((tool) => tool.function?.name === 'skill')
        && system.includes('Inspect and operate Windows apps, browser UI');
      if (step === 3) {
        owner = indicatorOwner();
        assert.match(owner, /^opencode:/);
        assert.ok(existsSync(join(tmpdir(), 'opencode-cu.ready')), 'countdown must finish before the next tool');
      }
      if (step === 4) {
        stoppedBeforeFinal = !indicatorIsUp() && indicatorOwner() !== owner;
        assert.ok(stoppedBeforeFinal, 'native hook must stop the indicator before the read result reaches the model');
      }
      action = actions[step++] || null;
    }
    const id = `fixture-${step}`;
    const message = action
      ? { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] }
      : { role: 'assistant', content: 'Local OpenCode integration fixture completed.' };
    if (input.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = action
        ? { role: 'assistant', tool_calls: message.tool_calls.map((tool) => ({ index: 0, ...tool })) }
        : message;
      for (const [value, finish] of [[delta, null], [{}, action ? 'tool_calls' : 'stop']]) {
        response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'local', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: 'local', choices: [{ index: 0, message, finish_reason: action ? 'tool_calls' : 'stop' }] }));
    }
  } catch (error) {
    serverError = error;
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: error.message } }));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const binary = process.argv[2] || join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
const config = {
  model: 'cu-fixture/local',
  enabled_providers: ['cu-fixture'],
  provider: {
    'cu-fixture': {
      npm: '@ai-sdk/openai-compatible',
      name: 'Local computer-use test fixture',
      options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'local-fixture' },
      models: { local: { name: 'Local fixture', tool_call: true, limit: { context: 65536, output: 2048 } } },
    },
  },
};
const child = spawn(binary, ['run', '--format', 'json', '--model', 'cu-fixture/local', '--title', 'Computer-use local fixture', '--dir', root, 'Run the local integration fixture.'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, XDG_CONFIG_HOME: join(folder, 'config'), OPENCODE_CONFIG: installed.config,
    OPENCODE_CONFIG_DIR: configDir, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; writeFileSync(join(folder, 'events.jsonl'), stdout); });
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); writeFileSync(join(folder, 'stderr.txt'), stderr); });
const timer = setTimeout(() => child.kill(), 90000);
try {
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  writeFileSync(join(folder, 'events.jsonl'), stdout);
  writeFileSync(join(folder, 'stderr.txt'), stderr);
  if (serverError) throw serverError;
  assert.equal(code, 0, stderr);
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const errors = events.filter((event) => event.type === 'error');
  assert.deepEqual(errors, [], JSON.stringify(errors));
  const tools = events.filter((event) => event.type === 'tool_use').map((event) => ({ name: event.part.tool, status: event.part.state.status }));
  assert.deepEqual(tools.map((tool) => tool.name), actions.map((action) => action[0]));
  assert.ok(tools.every((tool) => tool.status === 'completed'), JSON.stringify(tools));
  assert.ok(instructionsLoaded, 'native instructions must reach the model');
  for (const [name, loaded] of Object.entries(guidance)) assert.ok(loaded, `${name} guidance must reach the model automatically`);
  assert.ok(stoppedBeforeFinal);
  const report = { passed: true, tools, instructionsLoaded, guidance, stoppedBeforeFinal, artifacts: folder };
  writeFileSync(join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) child.kill();
  if (owner) requestIndicatorStop(owner);
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
