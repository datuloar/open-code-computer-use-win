import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForControl } from '../src/control-wait.js';

test('conditional waits distinguish missing, disabled and ready controls with bounded polling', async () => {
  let clock = 0;
  const budgets = [];
  const observations = [{ found: false }, { found: true, control: { enabled: false } }, { found: true, control: { enabled: true } }];
  const result = await waitForControl({ seconds: 1, now: () => clock,
    pause: async (ms) => { clock += ms; }, observe: async (budget) => { budgets.push(budget); return observations.shift(); } });
  assert.equal(result.checks, 3);
  assert.equal(result.waitedMs, 500);
  assert.equal(result.observation.control.enabled, true);
  assert.deepEqual(budgets, [1000, 750, 500]);
  const present = await waitForControl({ seconds: 1, state: 'exists', observe: async () => ({ found: true, control: { enabled: false } }) });
  assert.equal(present.observation.control.enabled, false);
});

test('a wait times out without accepting late observations or malformed provider output', async () => {
  let clock = 0;
  let checks = 0;
  await assert.rejects(waitForControl({ seconds: 0.3, now: () => clock,
    pause: async (ms) => { clock += ms; }, observe: async () => { checks++; return { found: false }; } }), /timed out after 0.3s/);
  assert.equal(clock, 300);
  assert.equal(checks, 2);
  clock = 0;
  await assert.rejects(waitForControl({ seconds: 1, now: () => clock, observe: async () => {
    clock = 1100; return { found: true, control: { enabled: true } };
  } }), /timed out/);
  await assert.rejects(waitForControl({ seconds: 1, observe: async () => ({ found: true }) }), /observation is invalid/);
  clock = 0;
  await assert.rejects(waitForControl({ seconds: 1, now: () => clock, observe: async () => {
    clock = 1000; throw new Error('backend deadline reached');
  } }), /timed out after 1s/);
});

test('cancellation settles a conditional wait before another observation starts', async () => {
  const controller = new AbortController();
  let checks = 0;
  const waiting = waitForControl({ seconds: 30, signal: controller.signal,
    observe: async () => { checks++; return { found: false }; } });
  await new Promise((done) => setImmediate(done));
  controller.abort();
  await assert.rejects(waiting, /abort/i);
  assert.equal(checks, 1);
});

test('provider errors and invalid wait settings fail without retrying', async () => {
  let checks = 0;
  await assert.rejects(waitForControl({ seconds: 1, observe: async () => { checks++; throw new Error('ambiguous target'); } }), /ambiguous target/);
  assert.equal(checks, 1);
  for (const seconds of [0, -1, 31, NaN, Infinity])
    await assert.rejects(waitForControl({ seconds, observe: () => assert.fail('must not observe') }), /conditional wait seconds/);
  await assert.rejects(waitForControl({ seconds: 1, state: 'clicked', observe: () => assert.fail('must not observe') }), /control state/);
});
