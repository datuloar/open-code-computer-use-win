import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedOutput } from '../src/backend.js';

test('broker failures are tool errors, including UTF-8 BOM and multiline output', () => {
  assert.equal(checkedOutput('\uFEFFCLICKED 12,34 left\r\n'), 'CLICKED 12,34 left');
  assert.throws(() => checkedOutput('\uFEFFERROR SendInput failed\r\n'), /SendInput failed/);
  assert.throws(() => checkedOutput('partial output\nERROR input stopped'), /input stopped/);
});
