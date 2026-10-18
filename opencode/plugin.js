import { randomUUID } from 'node:crypto';
import { createOpenCodeHooks } from '../src/opencode.js';

export default async function OpenCodeComputerUse(_context, options = {}) {
  return createOpenCodeHooks({ owner: `opencode:${randomUUID()}`, node: options.node || 'node' });
}
