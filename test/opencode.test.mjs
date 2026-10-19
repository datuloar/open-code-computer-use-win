import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { configureOpenCode, createOpenCodeHooks, pluginUrl, instructionsPath } from '../src/opencode.js';
import { installOpenCode, parseConfig } from '../src/install-opencode.js';
import { TOOLS } from '../src/mcp.js';
import FixtureGuard from './opencode-fixture-guard.js';

const folders = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-cu-opencode-'));
  folders.push(directory);
  return directory;
}

after(() => {
  for (const folder of folders) {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith('dsh-cu-opencode-'));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('OpenCode guidance fits a bounded context and names only exposed tools', () => {
  const instructions = readFileSync(instructionsPath, 'utf8');
  const skill = readFileSync(new URL('../opencode/SKILL.md', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(instructions) <= 4000, 'automatic guidance must remain compact');
  assert.ok(Buffer.byteLength(skill) <= 8500, 'on-demand guidance must remain focused');
  const exposed = new Set(TOOLS.map((tool) => `computer_${tool.name}`));
  for (const source of [instructions, skill]) {
    for (const match of source.matchAll(/`(computer_[a-z_]+)`/g)) assert.ok(exposed.has(match[1]), `${match[1]} is unavailable`);
  }
  for (const match of skill.matchAll(/\| `(computer_[a-z_]+)` \| `(\{[^`]+\})` \|/g)) {
    const tool = TOOLS.find((entry) => `computer_${entry.name}` === match[1]);
    const args = JSON.parse(match[2]);
    for (const required of tool.inputSchema.required) assert.ok(required in args, `${match[1]} requires ${required}`);
    for (const key of Object.keys(args)) assert.ok(key in tool.inputSchema.properties, `${match[1]} has no ${key}`);
  }
});

test('live model fixture guard rejects coordinate input and foreign window targets before execution', async () => {
  const hooks = await FixtureGuard({}, { pid: 1234, title: 'Test fixture' });
  for (const tool of ['computer_click', 'computer_move', 'computer_drag'])
    await assert.rejects(hooks['tool.execute.before']({ tool }, { args: { x: 1, y: 2 } }), /only permits named controls/);
  for (const tool of ['computer_focus', 'computer_tap']) {
    await assert.rejects(hooks['tool.execute.before']({ tool }, { args: { pid: 5678 } }), /only allowed input target/);
    await hooks['tool.execute.before']({ tool }, { args: { pid: 1234 } });
    await hooks['tool.execute.before']({ tool }, { args: { window: 'Test fixture' } });
  }
});

test('OpenCode configuration preserves other MCP servers, providers and settings', () => {
  const other = { model: 'example/model', mcp: { unity: { type: 'remote', url: 'http://localhost:8080' } },
    provider: { local: { options: { apiKey: 'test-value' } } }, plugin: ['another-plugin'], instructions: ['README.md'] };
  const config = configureOpenCode(structuredClone(other), { node: 'C:/Program Files/nodejs/node.exe', owner: 'opencode:test' });
  for (const key of ['model', 'provider', 'plugin', 'instructions']) assert.deepEqual(config[key], other[key]);
  assert.deepEqual(config.mcp.unity, other.mcp.unity);
  assert.equal(config.mcp.computer.command[0], 'C:/Program Files/nodejs/node.exe');
  assert.equal(config.mcp.computer.environment.DSH_CU_OWNER, 'opencode:test');
  assert.equal(config.mcp.computer.environment.DSH_CU_THEME, 'opencode');
  assert.throws(() => configureOpenCode({ mcp: { computer: { command: ['unrelated'] } } }), /already in use/);
});

test('OpenCode hooks stop only their own control and preserve the active session boundary', async () => {
  let current = '';
  const owner = 'opencode:test';
  const stopped = [];
  const hooks = createOpenCodeHooks({ owner, readOwner: () => current, stop: (token) => { stopped.push(token); current = ''; }, pause: async () => {} });
  const config = {};
  await hooks.config(config);
  assert.ok(config.instructions.includes(instructionsPath));
  assert.equal(config.mcp.computer.environment.DSH_CU_OWNER, owner);
  const before = (tool, sessionID = 'a', args = {}) => hooks['tool.execute.before']({ tool, sessionID }, { args });
  await before('computer_focus');
  current = owner;
  await assert.rejects(before('computer_click', 'b'), /another OpenCode session/);
  await assert.rejects(before('computer_indicator', 'b', { action: 'stop' }), /another OpenCode session/);
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'b' } } });
  assert.equal(current, owner);
  await before('read', 'b');
  assert.equal(current, owner);
  await before('read');
  assert.deepEqual(stopped, [owner]);
  current = 'mcp:someone-else';
  await hooks.dispose();
  assert.equal(current, 'mcp:someone-else');
});

test('OpenCode keeps an explicit disabled server and custom timeout on reinstall and startup', async () => {
  const configDir = fixture();
  const path = join(configDir, 'opencode.json');
  installOpenCode({ configDir });
  let config = parseConfig(readFileSync(path, 'utf8'));
  config.mcp.computer.enabled = false;
  config.mcp.computer.timeout = 45000;
  writeFileSync(path, JSON.stringify(config));
  installOpenCode({ configDir });
  config = parseConfig(readFileSync(path, 'utf8'));
  const hooks = createOpenCodeHooks({ owner: 'opencode:test' });
  await hooks.config(config);
  assert.equal(config.mcp.computer.enabled, false);
  assert.equal(config.mcp.computer.timeout, 45000);
  assert.ok(!config.instructions?.includes(instructionsPath));
  const compacted = { context: [] };
  await hooks['experimental.session.compacting']({ sessionID: 'test' }, compacted);
  assert.deepEqual(compacted.context, []);
});

test('OpenCode countdown selection survives reinstalls and native configuration hooks', async () => {
  const configDir = fixture();
  const path = join(configDir, 'opencode.json');
  installOpenCode({ configDir, announceSeconds: 3 });
  let config = parseConfig(readFileSync(path, 'utf8'));
  config.mcp.computer.environment.KEEP = 'unchanged';
  writeFileSync(path, JSON.stringify(config));
  installOpenCode({ configDir });
  config = parseConfig(readFileSync(path, 'utf8'));
  const hooks = createOpenCodeHooks({ owner: 'opencode:test', node: process.execPath });
  await hooks.config(config);
  assert.equal(config.mcp.computer.environment.DSH_CU_ANNOUNCE_SECONDS, '3');
  assert.equal(config.mcp.computer.environment.KEEP, 'unchanged');
  for (const seconds of [0, 5, 30]) {
    installOpenCode({ configDir, announceSeconds: seconds });
    assert.equal(parseConfig(readFileSync(path, 'utf8')).mcp.computer.environment.DSH_CU_ANNOUNCE_SECONDS, String(seconds));
  }
  for (const seconds of [-1, 31, 'bad', 2.5, true]) {
    const original = readFileSync(path, 'utf8');
    assert.throws(() => installOpenCode({ configDir, announceSeconds: seconds }), /must be/);
    assert.equal(readFileSync(path, 'utf8'), original);
  }
});

test('OpenCode completion, abort, permission wait and compaction release control', async () => {
  for (const type of ['session.idle', 'session.error', 'permission.asked', 'session.status', 'session.deleted']) {
    let current = 'opencode:test';
    const hooks = createOpenCodeHooks({ owner: current, readOwner: () => current, stop: () => { current = ''; }, pause: async () => {} });
    await hooks['tool.execute.before']({ tool: 'computer_type', sessionID: 'a' }, { args: {} });
    await hooks.event({ event: { type, properties: { sessionID: 'a', info: { id: 'a' }, status: { type: 'idle' } } } });
    assert.equal(current, '', type);
  }
  let current = 'opencode:test';
  const hooks = createOpenCodeHooks({ owner: current, readOwner: () => current, stop: () => { current = ''; }, pause: async () => {} });
  await hooks['tool.execute.before']({ tool: 'computer_type', sessionID: 'a' }, { args: {} });
  await hooks.event({ event: { type: 'message.updated', properties: { info: {
    sessionID: 'a', role: 'assistant', time: { completed: 123 }, finish: 'stop',
  } } } });
  assert.equal(current, '');
  current = 'opencode:test';
  await hooks['tool.execute.before']({ tool: 'computer_type', sessionID: 'a' }, { args: {} });
  const output = { context: [] };
  await hooks['experimental.session.compacting']({ sessionID: 'a' }, output);
  assert.equal(current, '');
  assert.match(output.context[0], /reobserve/i);
});

test('intermediate commentary cannot stop control while a desktop tool is running', async () => {
  let current = 'opencode:test';
  const hooks = createOpenCodeHooks({ owner: current, readOwner: () => current, stop: () => { current = ''; }, pause: async () => {} });
  await hooks['tool.execute.before']({ tool: 'computer_type', sessionID: 'a' }, { args: { text: 'test' } });
  await hooks['experimental.text.complete']?.({ sessionID: 'a' });
  await hooks.event({ event: { type: 'message.updated', properties: { info: {
    role: 'assistant', sessionID: 'a', time: { completed: 123 }, finish: 'tool-calls',
  } } } });
  assert.equal(current, 'opencode:test');
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'a' } } });
  assert.equal(current, '');
});

test('the OpenCode installer parses JSONC without changing URLs or literal comment characters', () => {
  const source = '\uFEFF{\n// comment\n"url":"https://example.com/a/*b*/", "text":"escaped \\" quote", /* block */ "items":[1,2,],\n}';
  const parsed = parseConfig(source);
  assert.equal(parsed.url, 'https://example.com/a/*b*/');
  assert.equal(parsed.text, 'escaped " quote');
  assert.deepEqual(parsed.items, [1, 2]);
  assert.throws(() => parseConfig('{ /* broken'), /unterminated/);
  assert.throws(() => parseConfig('[]'), /must be an object/);
});

test('installation is idempotent, backed up and removable without touching unrelated configuration', () => {
  const configDir = fixture();
  const path = join(configDir, 'opencode.json');
  const original = { model: 'example/model', provider: { custom: { options: { apiKey: 'fixture' } } },
    mcp: { unityMCP: { type: 'remote', url: 'http://localhost:8080' } }, plugin: ['keep-me'] };
  writeFileSync(path, JSON.stringify(original));
  const installed = installOpenCode({ configDir, node: 'node' });
  assert.ok(installed.backups && existsSync(installed.skill));
  let config = parseConfig(readFileSync(path, 'utf8'));
  assert.deepEqual(config.provider, original.provider);
  assert.deepEqual(config.mcp.unityMCP, original.mcp.unityMCP);
  assert.equal(config.plugin[1][0], pluginUrl);
  assert.equal(installOpenCode({ configDir, node: 'node' }).backups, null);
  installOpenCode({ configDir, uninstall: true });
  config = parseConfig(readFileSync(path, 'utf8'));
  assert.deepEqual(config.mcp, original.mcp);
  assert.deepEqual(config.plugin, original.plugin);
  assert.deepEqual(config.provider, original.provider);
  assert.ok(!existsSync(installed.skill));
});

test('invalid or conflicting OpenCode configuration is left byte-for-byte intact', () => {
  const configDir = fixture();
  const path = join(configDir, 'opencode.json');
  for (const text of ['{ invalid', '{"mcp":{"computer":{"type":"remote","url":"http://example.com"}}}']) {
    writeFileSync(path, text);
    assert.throws(() => installOpenCode({ configDir }));
    assert.equal(readFileSync(path, 'utf8'), text);
    assert.ok(!existsSync(join(configDir, 'skills')));
  }
});

test('an installation write failure rolls back the skill and keeps the original config', () => {
  const configDir = fixture();
  const path = join(configDir, 'opencode.json');
  const original = '{"model":"example/model"}';
  writeFileSync(path, original);
  assert.throws(() => installOpenCode({ configDir, write: (file, text) => {
    if (file === path) throw new Error('simulated disk failure');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  } }), /simulated disk failure/);
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.ok(!existsSync(join(configDir, 'skills', 'opencode-computer-use', 'SKILL.md')));
});

test('the default model changes only when the user explicitly selects one', () => {
  const configDir = fixture();
  const path = join(configDir, 'opencode.json');
  writeFileSync(path, '{"model":"example/model"}');
  installOpenCode({ configDir, model: 'opencode/example-free' });
  assert.equal(parseConfig(readFileSync(path, 'utf8')).model, 'opencode/example-free');
  installOpenCode({ configDir });
  assert.equal(parseConfig(readFileSync(path, 'utf8')).model, 'opencode/example-free');
  assert.throws(() => installOpenCode({ configDir, model: 'broken' }), /provider\/model/);
});

test('moving an installation preserves settings and removes only the explicit previous checkout', () => {
  const configDir = fixture();
  const previousRoot = join(configDir, 'previous checkout');
  const path = join(configDir, 'opencode.json');
  const previousPlugin = pathToFileURL(join(previousRoot, 'opencode', 'plugin.js')).href;
  const original = { model: 'example/model', provider: { example: { options: { apiKey: 'fixture-only' } } },
    plugin: [[previousPlugin, { node: process.execPath }], 'another-plugin'], instructions: ['other.md', join(previousRoot, 'opencode', 'INSTRUCTIONS.md')],
    mcp: { computer: { type: 'local', command: [process.execPath, join(previousRoot, 'opencode', 'mcp.js')], enabled: false,
      timeout: 45000, environment: { DSH_CU_ANNOUNCE_SECONDS: '3', CUSTOM: 'keep' } }, other: { type: 'remote', url: 'https://example.invalid/mcp' } } };
  writeFileSync(path, JSON.stringify(original));
  const installed = installOpenCode({ configDir, migrateFrom: previousRoot });
  const config = parseConfig(readFileSync(path, 'utf8'));
  assert.ok(installed.backups);
  assert.equal(config.model, original.model);
  assert.deepEqual(config.provider, original.provider);
  assert.deepEqual(config.mcp.other, original.mcp.other);
  assert.equal(config.mcp.computer.enabled, false);
  assert.equal(config.mcp.computer.timeout, 45000);
  assert.equal(config.mcp.computer.environment.DSH_CU_ANNOUNCE_SECONDS, '3');
  assert.equal(config.mcp.computer.environment.CUSTOM, 'keep');
  assert.ok(config.plugin.includes('another-plugin'));
  assert.deepEqual(config.instructions, ['other.md']);
  assert.ok(!JSON.stringify(config).includes(previousRoot.replaceAll('\\', '\\\\')));
  assert.equal(config.plugin.at(-1)[0], pluginUrl);
  assert.equal(installOpenCode({ configDir, migrateFrom: previousRoot }).backups, null);
  const unchanged = readFileSync(path, 'utf8');
  const foreign = structuredClone(original);
  foreign.mcp.computer.command[1] = join(configDir, 'foreign.js');
  writeFileSync(path, JSON.stringify(foreign));
  const foreignText = readFileSync(path, 'utf8');
  assert.throws(() => installOpenCode({ configDir, migrateFrom: previousRoot }), /does not belong/);
  assert.equal(readFileSync(path, 'utf8'), foreignText);
  writeFileSync(path, unchanged);
});
