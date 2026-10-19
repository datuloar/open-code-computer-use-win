import { setTimeout as delay } from 'node:timers/promises';
import { ToolError } from './tool-error.js';

export async function waitForControl({ observe, seconds, state = 'enabled', signal,
  now = () => performance.now(), pause = (ms, signal) => delay(ms, undefined, { signal }) }) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30)
    throw new ToolError('conditional wait seconds must be greater than 0 and at most 30');
  if (!['exists', 'enabled'].includes(state)) throw new ToolError('control state must be exists or enabled');
  const started = now();
  const deadline = started + seconds * 1000;
  let checks = 0;
  while (now() < deadline) {
    signal?.throwIfAborted();
    let observation;
    try { observation = await observe(Math.max(1, Math.ceil(deadline - now()))); }
    catch (error) {
      signal?.throwIfAborted();
      if (now() >= deadline) break;
      throw error;
    }
    signal?.throwIfAborted();
    checks++;
    if (typeof observation?.found !== 'boolean'
      || (observation.found && typeof observation.control?.enabled !== 'boolean'))
      throw new ToolError('the control observation is invalid; inspect the window before retrying');
    if (now() > deadline) break;
    if (observation.found && (state === 'exists' || observation.control.enabled))
      return { condition: state, waitedMs: Math.round(now() - started), checks, observation };
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(250, remaining), signal);
  }
  throw new ToolError(`timed out after ${seconds}s waiting for a control to be ${state}; no input was sent`);
}
