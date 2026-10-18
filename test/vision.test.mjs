import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVisionQuestion, parseObservation } from '../src/vision.js';
import { handle } from '../src/mcp.js';

test('vision questions are bounded before capture or server startup', () => {
  for (const value of [undefined, null, '', ' ', 'x'.repeat(2001)]) assert.throws(() => validateVisionQuestion(value));
  assert.equal(validateVisionQuestion(' find the menu '), 'find the menu');
});

test('vision maps normalized boxes into screen pixels and rejects malformed boxes', () => {
  const answer = JSON.stringify({ answer: 'Button', found: true, bbox: [100, 200, 300, 400] });
  assert.deepEqual(parseObservation(answer, 800, 600, { x: 400, y: 50 }).screen_point, [560, 230]);
  for (const bbox of [[-1, 0, 100, 100], [0, 0, 1001, 100], [100, 0, 0, 100], ['0', 0, 100, 100], null]) {
    assert.equal(parseObservation(JSON.stringify({ answer: 'uncertain', found: true, bbox }), 800, 600, { x: 0, y: 0 }).screen_point, null);
  }
  assert.throws(() => parseObservation('not JSON', 800, 600, { x: 0, y: 0 }), /invalid JSON/);
});

test('vision rejects missing questions and incomplete regions without touching the desktop', async () => {
  for (const args of [{}, { question: 'find menu', x: 0 }]) {
    const reply = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'see', arguments: args } });
    assert.equal(reply.result.isError, true);
  }
});
