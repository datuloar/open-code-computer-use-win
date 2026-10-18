import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  cursorMayBeHidden,
  forgetHumanStop,
  humanStopSeconds,
  indicatorIsUp,
  indicatorOwner,
  indicatorProcessAlive,
  indicatorReady,
  ps,
  requireIndicator,
  requestIndicatorStop,
  serveCommand,
  sleep,
  useHost,
} from './backend.js';
import { commandIsGated, findCommand } from './commands.js';
import { BackendHost } from './host.js';
import { ToolError } from './tool-error.js';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HUMAN_STOP_HOLD_SECONDS = 600;
const MAX_WAIT_SECONDS = 30;
const OWNER = process.env.DSH_CU_OWNER || `mcp:${randomUUID()}`;
const requests = new Map();
let activeRequest = null;
let runningHost = null;
let closing = false;

async function stopOwnedIndicator() {
  const deadline = Date.now() + 2000;
  let observed = indicatorOwner() === OWNER;
  while (Date.now() < deadline) {
    observed = requestIndicatorStop(OWNER) || observed;
    if (observed && indicatorOwner() !== OWNER) return;
    await sleep(50);
  }
}

const INSTRUCTIONS =
  'Windows desktop control. Read before acting: ui_tree/find list controls with a point to click, ' +
  'read_text is OCR; see gives local visual answers as text even to non-vision models. Act with tap ' +
  '(by name) or click (by point), then read again to verify. Input tools start the on-screen ' +
  'indicator by themselves. Call indicator with action="stop" after each desktop interaction, ' +
  'before shell work, lengthy reasoning or a reply, including on failure. The next input starts a new countdown. ' +
  'If the human pressed ESC, stop and ask them before continuing.';

const region = {
  x: { type: 'integer', description: 'left edge of a screen region' },
  y: { type: 'integer', description: 'top edge of a screen region' },
  width: { type: 'integer', minimum: 1 },
  height: { type: 'integer', minimum: 1 },
};

const target = {
  window: { type: 'string', description: 'part of the window title; default is the foreground window' },
  pid: { type: 'integer', description: 'process id of the window instead of a title' },
};

const point = {
  x: { type: 'integer', description: 'screen x in physical pixels' },
  y: { type: 'integer', description: 'screen y in physical pixels' },
};

function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function round(value, name = 'value') {
  const number = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(number)) throw new ToolError(`${name} must be a number, got ${JSON.stringify(value)}`);
  return String(Math.round(number));
}

function regionArgs(args, flag) {
  const values = [args.x, args.y, args.width, args.height];
  if (values.every((value) => value === undefined)) return [];
  if (values.some((value) => value === undefined)) {
    throw new ToolError('a region needs all four of x, y, width and height');
  }
  return [flag, ...values.map((value, index) => round(value, ['x', 'y', 'width', 'height'][index]))];
}

function targetArgs(args) {
  if (args.window !== undefined && args.pid !== undefined) {
    throw new ToolError('pass window or pid, not both');
  }
  if (args.window !== undefined) return ['--title', String(args.window)];
  if (args.pid !== undefined) return ['--pid', round(args.pid, 'pid')];
  return [];
}

export const TOOLS = [
  {
    name: 'see',
    description: 'See the screen through local vision and get a text answer. Ask a specific question; crop to the relevant window for speed.',
    inputSchema: schema({ question: { type: 'string', maxLength: 2000 }, ...region }, ['question']),
    cli: (args) => ['see', args.question, ...regionArgs(args, '--region')],
  },
  {
    name: 'ui_tree',
    description:
      'List the controls of a window (UI Automation): role, name and a clickable point each. ' +
      'Works for native apps and Chrome/Edge pages. Cheapest way to see a window.',
    inputSchema: schema({
      ...target,
      depth: { type: 'integer', minimum: 1, maximum: 20, description: 'tree depth, default 6; web pages need 10-14' },
    }),
    cli: (args) => ['tree', ...targetArgs(args), ...(args.depth ? ['--depth', round(args.depth, 'depth')] : [])],
  },
  {
    name: 'find',
    description: 'Controls in a window whose name contains the text, each with a clickable point.',
    inputSchema: schema({ text: { type: 'string' }, ...target }, ['text']),
    cli: (args) => ['find', String(args.text), ...targetArgs(args)],
  },
  {
    name: 'tap',
    description:
      'Click the one control whose name matches the text. Refuses and lists candidates when the name ' +
      'is ambiguous, and refuses when another window covers the control.',
    inputSchema: schema({ text: { type: 'string' }, ...target }, ['text']),
    gated: true,
    cli: (args) => ['tap', String(args.text), ...targetArgs(args)],
  },
  {
    name: 'read_text',
    description:
      'Read the screen or a region as text with Windows OCR; every line comes with the point to ' +
      'click. Use for games, canvases and apps without a control tree.',
    inputSchema: schema({ ...region, lang: { type: 'string', description: 'en-US, ru, ...; default user language' } }),
    cli: (args) => ['read', ...regionArgs(args, '--region'), ...(args.lang ? ['--lang', String(args.lang)] : [])],
  },
  {
    name: 'screenshot',
    description:
      'Capture the screen or a region as a PNG. Use a region; a full screen is expensive. Returns ' +
      'the image and its file path.',
    inputSchema: schema(region),
    image: true,
    cli: (args) => ['shot', ...regionArgs(args, '--region')],
  },
  {
    name: 'click',
    description: 'Click at a screen point.',
    inputSchema: schema(
      { ...point, button: { type: 'string', enum: ['left', 'right', 'middle', 'double', 'triple'] } },
      ['x', 'y'],
    ),
    gated: true,
    cli: (args) => ['click', round(args.x, 'x'), round(args.y, 'y'), args.button ?? 'left'],
  },
  {
    name: 'move',
    description: 'Move the pointer to a point, for hover menus and tooltips.',
    inputSchema: schema(point, ['x', 'y']),
    gated: true,
    cli: (args) => ['move', round(args.x, 'x'), round(args.y, 'y')],
  },
  {
    name: 'drag',
    description: 'Press at one point, glide to another, release: sliders, selections, drag and drop.',
    inputSchema: schema(
      { ...point, to_x: { type: 'integer' }, to_y: { type: 'integer' } },
      ['x', 'y', 'to_x', 'to_y'],
    ),
    gated: true,
    cli: (args) => ['drag', round(args.x, 'x'), round(args.y, 'y'), round(args.to_x, 'to_x'), round(args.to_y, 'to_y')],
  },
  {
    name: 'scroll',
    description:
      'Scroll by notches at a point: negative scrolls down (or right), positive up (or left). ' +
      'A screenful is about 5 notches.',
    inputSchema: schema(
      { notches: { type: 'integer' }, ...point, horizontal: { type: 'boolean' } },
      ['notches'],
    ),
    gated: true,
    cli: (args) => {
      const notches = Number(round(args.notches, 'notches'));
      if (notches === 0) throw new ToolError('notches must not be zero');
      const at = args.x === undefined || args.y === undefined ? [] : [round(args.x, 'x'), round(args.y, 'y')];
      return ['wheel', String(notches * 120), ...at, ...(args.horizontal ? ['--horizontal'] : [])];
    },
  },
  {
    name: 'type',
    description: 'Type text into the focused control. A newline is Enter, a tab is Tab.',
    inputSchema: schema({ text: { type: 'string', maxLength: 2000 } }, ['text']),
    gated: true,
    cli: (args) => ['type', String(args.text)],
  },
  {
    name: 'press',
    description: 'Press a key (Enter, Esc, Tab, PageDown, F5, ...) or a combination (ctrl+l, ctrl+shift+t).',
    inputSchema: schema({ keys: { type: 'string' } }, ['keys']),
    gated: true,
    cli: (args) => {
      const keys = String(args.keys).trim();
      return keys.includes('+') && keys.length > 1 ? ['keys', keys] : ['key', keys];
    },
  },
  {
    name: 'windows',
    description: 'Visible windows with pid, title and rectangle.',
    inputSchema: schema({}),
    cli: () => ['windows', '--json'],
  },
  {
    name: 'focus',
    description: 'Bring a window to the front and verify it is in front.',
    gated: true,
    inputSchema: schema(target),
    cli: (args) => {
      if (args.window !== undefined && args.pid === undefined) return ['focus', '--title', String(args.window)];
      if (args.pid !== undefined && args.window === undefined) return ['focus', round(args.pid, 'pid')];
      throw new ToolError('pass exactly one of window or pid');
    },
  },
  {
    name: 'wait',
    description: 'Wait for an animation, a page load or a game round, up to 30 seconds.',
    inputSchema: schema({ seconds: { type: 'number', minimum: 0, maximum: MAX_WAIT_SECONDS } }, ['seconds']),
    local: async (args, signal) => {
      const seconds = Math.max(0, Math.min(MAX_WAIT_SECONDS, Number(args.seconds) || 0));
      await delay(seconds * 1000, undefined, { signal });
      return `WAITED ${seconds}s`;
    },
  },
  {
    name: 'indicator',
    description:
      'Start or stop the on-screen indicator. Input tools start it themselves; call stop when the ' +
      'desktop interaction ends, before shell work or a reply, including on failure.',
    inputSchema: schema(
      {
        action: { type: 'string', enum: ['start', 'stop'] },
        hide_cursor: { type: 'boolean', description: 'replace the human pointer with the drawn marker' },
      },
      ['action'],
    ),
    local: async (args) => {
      if (args.action === 'stop') {
        if (indicatorIsUp() && indicatorOwner() !== OWNER) return 'STOPPED (this client does not own the active indicator)';
        return runCli(['overlay', '--stop']);
      }
      if (args.action !== 'start') throw new ToolError('action must be start or stop');
      refuseAfterHumanStop();
      return startIndicator(Boolean(args.hide_cursor));
    },
  },
];

let sink = null;

function captureConsole() {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    console[level] = (...parts) => {
      if (sink) sink.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
    };
  }
}

async function runCli(argv) {
  const [name, ...args] = argv;
  const command = findCommand(name);
  const previous = sink;
  sink = [];
  try {
    if (commandIsGated(command, args)) requireIndicator();
    await command.run(args);
    return sink.join('\n').trim();
  } finally {
    sink = previous;
  }
}

function refuseAfterHumanStop() {
  const seconds = humanStopSeconds();
  if (seconds < HUMAN_STOP_HOLD_SECONDS) {
    throw new ToolError(
      `The human pressed ESC ${Math.round(seconds)}s ago to take the computer back. Do not continue ` +
        'with mouse or keyboard input; tell the user where you stopped and ask before trying again.',
    );
  }
}

async function startIndicator(hideCursor) {
  if (indicatorIsUp() && indicatorOwner() !== OWNER)
    throw new ToolError('another computer-use client owns the desktop; wait for it to stop');
  forgetHumanStop();
  return runCli(['overlay', ...(hideCursor ? ['--hide-cursor'] : [])]);
}

async function ensureIndicator() {
  refuseAfterHumanStop();
  if (cursorMayBeHidden() && !indicatorProcessAlive()) await ps(['overlay', 'restore-cursor']);
  if (indicatorIsUp() && indicatorProcessAlive()) {
    if (indicatorOwner() !== OWNER) throw new ToolError('another computer-use client owns the desktop; wait for it to stop');
    const deadline = Date.now() + 35_000;
    while (!indicatorReady()) {
      refuseAfterHumanStop();
      if (!indicatorIsUp() || !indicatorProcessAlive()) throw new ToolError('the indicator stopped during the announcement');
      if (Date.now() >= deadline) throw new ToolError('the indicator did not finish the countdown');
      await sleep(50);
    }
    return '';
  }
  refuseAfterHumanStop();
  return `${await startIndicator(false)}\n`;
}

async function callTool(name, args, signal) {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new ToolError(`unknown tool "${name}"`);
  const input = args === undefined ? {} : args;
  validateArguments(tool.inputSchema, input);
  signal?.throwIfAborted();
  if (tool.local) return { content: [{ type: 'text', text: await tool.local(input, signal) }] };
  const argv = tool.cli(input);
  const preface = tool.gated ? await ensureIndicator() : '';
  signal?.throwIfAborted();
  const text = `${preface}${await runCli(argv)}`.trim();
  signal?.throwIfAborted();
  const content = [{ type: 'text', text }];
  if (tool.image) {
    const saved = /^SAVED (.+) \d+ bytes$/m.exec(text);
    if (saved) content.push({ type: 'image', data: readFileSync(saved[1]).toString('base64'), mimeType: 'image/png' });
  }
  return { content };
}

function validateArguments(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be an object');
  for (const name of schema.required) {
    if (args[name] === undefined) throw new ToolError(`${name} is required`);
  }
  for (const [name, value] of Object.entries(args)) {
    const spec = schema.properties[name];
    if (!spec) throw new ToolError(`unknown argument "${name}"`);
    if (spec.type === 'integer' || spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new ToolError(`${name} must be a number`);
      if (spec.type === 'integer' && !Number.isInteger(value)) throw new ToolError(`${name} must be an integer`);
      if (spec.minimum !== undefined && value < spec.minimum) throw new ToolError(`${name} must be at least ${spec.minimum}`);
      if (spec.maximum !== undefined && value > spec.maximum) throw new ToolError(`${name} must be at most ${spec.maximum}`);
      if (['x', 'y', 'to_x', 'to_y', 'width', 'height'].includes(name) && Math.abs(value) > 32767)
        throw new ToolError(`${name} must be between -32767 and 32767`);
      if (name === 'pid' && value <= 0) throw new ToolError('pid must be positive');
      if (name === 'notches' && Math.abs(value) > 17895697) throw new ToolError('notches is too large');
    } else if (typeof value !== spec.type) {
      throw new ToolError(`${name} must be a ${spec.type}`);
    }
    if (spec.type === 'string' && (name === 'text' ? value.length === 0 : !value.trim()))
      throw new ToolError(`${name} must not be empty`);
    if (spec.maxLength !== undefined && value.length > spec.maxLength)
      throw new ToolError(`${name} must be at most ${spec.maxLength} characters; split it into smaller calls`);
    if (spec.enum && !spec.enum.includes(value)) throw new ToolError(`${name} must be ${spec.enum.join(', ')}`);
  }
  if ('notches' in args && (args.x === undefined) !== (args.y === undefined))
    throw new ToolError('scroll needs both x and y, or neither');
}

let queue = Promise.resolve();

function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

export async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(message?.id ?? null, -32600, 'invalid request');
  }
  const { id, method, params } = message;
  if (id !== undefined && id !== null && typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id)))
    return failure(null, -32600, 'invalid request id');
  if (method === 'notifications/cancelled') {
    const request = requests.get(params?.requestId);
    if (request) {
      request.controller.abort(new ToolError('the tool call was cancelled; observe the desktop before retrying'));
      if (activeRequest === request) {
        if (request.changesControl || indicatorOwner() === OWNER) request.cleanup = stopOwnedIndicator();
        request.cancelTimer = setTimeout(() => {
          if (activeRequest === request) runningHost?.kill(new ToolError('the tool call was cancelled; input was stopped'));
        }, 1000);
      }
    }
    return null;
  }
  if (id === undefined) return null;
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return success(id, {
        protocolVersion: PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: process.env.DSH_CU_THEME === 'opencode' ? 'opencode-computer-use' : 'dsh-cu', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      if (requests.has(id)) return failure(id, -32600, 'a request with this id is already running');
      const request = {
        controller: new AbortController(),
        changesControl: Boolean(TOOLS.find((tool) => tool.name === params?.name)?.gated)
          || (params?.name === 'indicator' && params?.arguments?.action === 'start'),
      };
      requests.set(id, request);
      return serial(async () => {
        let result;
        try {
          if (closing) throw new ToolError('the MCP connection is closing');
          activeRequest = request;
          result = await callTool(params?.name, params?.arguments, request.controller.signal);
        } catch (error) {
          const text = error instanceof ToolError ? error.message : `${error.message}`;
          result = { content: [{ type: 'text', text }], isError: true };
        } finally {
          if (request.cleanup) await request.cleanup;
          clearTimeout(request.cancelTimer);
          activeRequest = null;
          requests.delete(id);
        }
        if (indicatorIsUp() && indicatorProcessAlive()) {
          result.content.push({ type: 'text', text: 'Desktop control is still ON. Call indicator with action="stop" before switching to shell work or replying. Idle shutdown: 60s without a desktop command.' });
        }
        return success(id, result);
      });
    }
    default:
      return failure(id, -32601, `method not found: ${method}`);
  }
}

function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function serve() {
  process.env.DSH_CU_OWNER = OWNER;
  captureConsole();
  const host = new BackendHost(serveCommand());
  runningHost = host;
  useHost(host);
  const write = (response) => {
    if (response && !closing) process.stdout.write(`${JSON.stringify(response)}\n`);
  };
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write(failure(null, -32700, 'parse error'));
      return;
    }
    Promise.resolve(handle(message)).then(write, (error) => write(failure(message.id ?? null, -32603, error.message)));
  });
  const shutdown = () => {
    if (closing) return;
    closing = true;
    for (const request of requests.values()) request.controller.abort(new ToolError('the MCP connection closed'));
    requestIndicatorStop(OWNER);
    setTimeout(() => { host.kill(); useHost(null); }, 1000);
    const deadline = Date.now() + 2000;
    const finish = () => {
      requestIndicatorStop(OWNER);
      if (Date.now() >= deadline) process.exit(0);
      else setTimeout(finish, 50);
    };
    finish();
  };
  lines.on('close', shutdown);
  process.stdin.on('error', shutdown);
  process.stdout.on('error', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', () => requestIndicatorStop(OWNER));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) serve();
