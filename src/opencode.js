import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { indicatorOwner, requestIndicatorStop, root, sleep } from './backend.js';
import { TOOLS } from './mcp.js';
import { parseAnnounceSeconds } from './settings.js';

export const SERVER_NAME = 'computer';
export const SKILL_NAME = 'opencode-computer-use';
export const pluginUrl = pathToFileURL(join(root, 'opencode', 'plugin.js')).href;
export const instructionsPath = join(root, 'opencode', 'INSTRUCTIONS.md');
const inputTools = new Set(TOOLS.filter((tool) => tool.gated).map((tool) => `${SERVER_NAME}_${tool.name}`));

export function configureOpenCode(config, { node = 'node', owner, announceSeconds } = {}) {
  if (config.mcp !== undefined && (!config.mcp || typeof config.mcp !== 'object' || Array.isArray(config.mcp)))
    throw new Error('OpenCode mcp must be an object');
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error('OpenCode plugin must be an array');
  if (config.instructions !== undefined && !Array.isArray(config.instructions))
    throw new Error('OpenCode instructions must be an array');
  const existing = config.mcp?.[SERVER_NAME];
  const entry = join(root, 'opencode', 'mcp.js');
  if (existing && (!Array.isArray(existing.command) || existing.command[1] !== entry))
    throw new Error('the OpenCode MCP name "computer" is already in use; rename that entry before installing');
  const environment = existing?.environment || {};
  const announcement = announceSeconds ?? environment.OPENCODE_CU_ANNOUNCE_SECONDS;
  if (announcement !== undefined) parseAnnounceSeconds(announcement, 'OPENCODE_CU_ANNOUNCE_SECONDS');
  config.mcp = {
    ...config.mcp,
    [SERVER_NAME]: {
      ...existing,
      type: 'local',
      command: [node, entry],
      enabled: existing?.enabled ?? true,
      timeout: existing?.timeout ?? 120000,
      environment: { ...environment, ...(owner ? { OPENCODE_CU_OWNER: owner } : {}),
        ...(announcement !== undefined ? { OPENCODE_CU_ANNOUNCE_SECONDS: String(parseAnnounceSeconds(announcement)) } : {}) },
    },
  };
  return config;
}

export function createOpenCodeHooks({ owner, node, readOwner = indicatorOwner, stop = requestIndicatorStop, pause = sleep }) {
  let session = null;
  let stopping = null;
  let enabled = true;
  const stopOwnedControl = async () => {
    if (stopping) return stopping;
    if (readOwner() !== owner) { session = null; return; }
    stopping = (async () => {
      stop(owner);
      for (let attempt = 0; attempt < 60 && readOwner() === owner; attempt++) await pause(50);
      if (readOwner() === owner) throw new Error('OpenCode desktop control did not stop; press ESC before continuing');
      session = null;
    })().finally(() => { stopping = null; });
    return stopping;
  };
  return {
    config: async (config) => {
      configureOpenCode(config, { node, owner });
      enabled = config.mcp[SERVER_NAME].enabled !== false;
      if (enabled)
        config.instructions = [...new Set([...(config.instructions || []), instructionsPath])];
    },
    'tool.execute.before': async (input, output) => {
      if (!input.tool.startsWith(`${SERVER_NAME}_`)) {
        if (!session || session === input.sessionID) await stopOwnedControl();
        return;
      }
      const startsInput = inputTools.has(input.tool)
        || (input.tool === `${SERVER_NAME}_indicator` && output.args?.action === 'start');
      const changesControl = startsInput || input.tool === `${SERVER_NAME}_indicator`;
      if (!changesControl) return;
      if (session && session !== input.sessionID && readOwner() === owner)
        throw new Error('another OpenCode session is using the desktop; wait for it to finish');
      if (startsInput) session = input.sessionID;
    },
    event: async ({ event }) => {
      const info = event.properties?.info;
      const id = event.properties?.sessionID ?? info?.sessionID ?? info?.id;
      if (!session || id !== session) return;
      if (['session.idle', 'session.error', 'session.deleted', 'permission.asked'].includes(event.type)
        || (event.type === 'session.status' && event.properties?.status?.type === 'idle')
        || (event.type === 'message.updated' && info?.role === 'assistant' && info.time?.completed
          && info.finish && !['tool-calls', 'unknown'].includes(info.finish))) await stopOwnedControl();
    },
    'experimental.session.compacting': async (input, output) => {
      if (input.sessionID === session) await stopOwnedControl();
      if (!enabled) return;
      output.context.push('Desktop control: load opencode-computer-use before input if needed. Reuse the observed target pid; prefer targeted find/tap. Use find with details:true for field values; require valueStatus available and truncated false for an exact match. Use wait with text and pid for conditional readiness. Fall back to cropped OCR or vision. Reobserve after layout changes; inspect partial input before retrying. Keep related computer_* calls sequential, then stop computer_indicator before leaving the GUI. Physical ESC means stop and ask the user.');
    },
    dispose: stopOwnedControl,
  };
}
