import { ToolError } from './tool-error.js';

export const DEFAULT_ANNOUNCE_SECONDS = 5;
export const MAX_ANNOUNCE_SECONDS = 30;

export function parseAnnounceSeconds(value = DEFAULT_ANNOUNCE_SECONDS, name = 'announce seconds') {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^-?\d+$/.test(String(value).trim()))
    throw new ToolError(`${name} must be an integer`);
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_ANNOUNCE_SECONDS)
    throw new ToolError(`${name} must be between 0 and ${MAX_ANNOUNCE_SECONDS}`);
  return seconds;
}
