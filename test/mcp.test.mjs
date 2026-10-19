import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, TOOLS } from '../src/mcp.js';

const request = (method, params, id = 1) => handle({ jsonrpc: '2.0', id, method, params });

test('initialize answers with the requested protocol and the server name', async () => {
  const response = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
  assert.equal(response.result.protocolVersion, '2025-03-26');
  assert.equal(response.result.serverInfo.name, 'opencode-computer-use');
  assert.ok(response.result.capabilities.tools);
  assert.ok(response.result.instructions.length > 40);
});

test('an unknown protocol version falls back to the newest one this server speaks', async () => {
  const response = await request('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(response.result.protocolVersion, '2025-06-18');
});

test('tools/list publishes every tool with an object schema and no duplicates', async () => {
  const response = await request('tools/list', {});
  const names = response.result.tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of response.result.tools) {
    assert.match(tool.name, /^[a-z_]{1,32}$/);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 10, `${tool.name} needs a description`);
  }
  assert.ok(names.includes('ui_tree') && names.includes('tap') && names.includes('screenshot'));
});

test('the tool list stays small enough to send with every request', () => {
  const bytes = JSON.stringify(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))
    .length;
  assert.ok(bytes < 7000, `tool definitions grew to ${bytes} bytes`);
});

test('notifications get no answer and unknown methods get a JSON-RPC error', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const response = await request('resources/list', {});
  assert.equal(response.error.code, -32601);
});

test('bad arguments fail as a tool error before anything touches the machine', async () => {
  const cases = [
    ['click', { x: 'abc', y: 1 }, /x must be a number/],
    ['scroll', { notches: 0 }, /must not be zero/],
    ['read_text', { x: 1, y: 2 }, /all four of x, y, width and height/],
    ['focus', {}, /exactly one of window or pid/],
    ['ui_tree', { window: 'a', pid: 1 }, /not both/],
    ['nonsense', {}, /unknown tool/],
    ['type', {}, /text is required/],
    ['type', { text: null }, /text must be a string/],
    ['click', { x: null, y: 1 }, /x must be a number/],
    ['click', { x: 1.2, y: 1 }, /x must be an integer/],
    ['click', { x: 99999, y: 1 }, /between -32767 and 32767/],
    ['click', { x: 1, y: 1, button: 'sideways' }, /button must be/],
    ['scroll', { notches: 1, x: 1 }, /both x and y/],
    ['focus', { pid: -1 }, /pid must be positive/],
    ['ui_tree', { depth: 0 }, /depth must be at least 1/],
    ['wait', { seconds: -1 }, /seconds must be at least 0/],
    ['indicator', { action: 'start', hide_cursor: 'false' }, /hide_cursor must be a boolean/],
    ['type', { text: 'hello', extra: true }, /unknown argument/],
    ['type', { text: 'x'.repeat(2001) }, /at most 2000 characters/],
    ['see', { question: 'x'.repeat(2001) }, /at most 2000 characters/],
    ['find', { text: 'Field', max_chars: 100 }, /requires details/],
    ['find', { text: 'Field', details: true, max_chars: 2001 }, /at most 2000/],
    ['wait', { seconds: 0, text: 'Ready' }, /conditional wait seconds/],
    ['wait', { seconds: 1, pid: 123 }, /requires text/],
    ['wait', { seconds: 1, text: 'Ready', pid: 1, window: 'Test' }, /not both/],
  ];
  for (const [name, args, pattern] of cases) {
    const response = await request('tools/call', { name, arguments: args });
    assert.equal(response.result.isError, true, `${name} should fail`);
    assert.match(response.result.content[0].text, pattern);
  }
});

test('detailed finding uses the same CLI inspection without adding another model tool', () => {
  const find = TOOLS.find((tool) => tool.name === 'find');
  assert.deepEqual(find.cli({ text: 'Field', pid: 123, details: true, max_chars: 40 }),
    ['inspect', 'Field', '--pid', '123', '--max-chars', '40']);
  assert.deepEqual(find.cli({ text: 'Field' }), ['find', 'Field']);
  assert.equal(TOOLS.some((tool) => tool.name === 'inspect'), false);
});

test('wait runs locally and reports how long it waited', async () => {
  const response = await request('tools/call', { name: 'wait', arguments: { seconds: 0.01 } });
  assert.match(response.result.content[0].text, /^WAITED 0.01s$/);
});

test('malformed JSON-RPC values receive an invalid request error', async () => {
  for (const message of [null, [], 42, {}, { jsonrpc: '1.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: {}, method: 'ping' }, { jsonrpc: '2.0', id: true, method: 'ping' }]) {
    const response = await handle(message);
    assert.equal(response.error.code, -32600);
  }
});

test('MCP cancellation interrupts waits and skips queued work without replaying it', async () => {
  const start = Date.now();
  const waiting = request('tools/call', { name: 'wait', arguments: { seconds: 10 } }, 51);
  await new Promise((done) => setImmediate(done));
  const queued = request('tools/call', { name: 'wait', arguments: { seconds: 10 } }, 52);
  await handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 52 } });
  await handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 51 } });
  for (const response of await Promise.all([waiting, queued])) assert.equal(response.result.isError, true);
  assert.ok(Date.now() - start < 1000);
  assert.equal((await request('ping', {})).result.constructor, Object);
});

test('duplicate in-flight request ids fail without replacing the original', async () => {
  const first = request('tools/call', { name: 'wait', arguments: { seconds: 0.01 } }, 71);
  const duplicate = await request('tools/call', { name: 'wait', arguments: { seconds: 0 } }, 71);
  assert.equal(duplicate.error.code, -32600);
  assert.equal((await first).result.isError, undefined);
});
