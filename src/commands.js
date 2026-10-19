import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backendScript,
  brokerIsUp,
  cursorMayBeHidden,
  exec,
  forgetHumanStop,
  indicatorIsUp,
  indicatorProcessAlive,
  indicatorReady,
  input,
  isWindows,
  ps,
  requireIndicator,
  root,
  sleep,
  SLOW_BACKEND_TIMEOUT_MS,
  temp,
} from './backend.js';
import { ToolError } from './tool-error.js';
import { describeImage, ensureVision, validateVisionQuestion } from './vision.js';
import { DEFAULT_ANNOUNCE_SECONDS, parseAnnounceSeconds } from './settings.js';
import { waitForControl } from './control-wait.js';

const MIN_SCREENSHOT_BYTES = 1024;
const MIN_REGION_BYTES = 120;
const MAX_COORDINATE = 32767;
const TYPE_CHUNK_CHARS = 200;
const ONE_SHOT_FLAGS = { '--stop': 'stop', '--restore-cursor': 'restore-cursor' };
const START_FLAGS = ['--quiet', '--hide-cursor'];
const CLICK_MODES = ['left', 'right', 'middle', 'double', 'triple'];
const KEY_PHASES = ['', 'down', 'up'];
const CLIPBOARD_ACTIONS = ['get', 'set', 'clear'];
const MAX_TREE_DEPTH = 20;
const BROKER_ACTIONS = ['start', 'stop', 'status'];

function integer(value, name) {
  if (value === undefined) throw new ToolError(`${name} is required`);
  if (!/^-?\d+$/.test(String(value).trim())) throw new ToolError(`${name} must be an integer, got "${value}"`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new ToolError(`${name} must be a safe integer`);
  return number;
}

function coordinate(value, name) {
  const number = integer(value, name);
  if (number < -MAX_COORDINATE || number > MAX_COORDINATE) {
    throw new ToolError(`${name} must be between -${MAX_COORDINATE} and ${MAX_COORDINATE}, got ${number}`);
  }
  return number;
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new ToolError(`${name} must be ${allowed.filter(Boolean).join(', ')}, got "${value}"`);
  }
  return value;
}

function required(value, name) {
  const text = (value ?? '').trim();
  if (!text) throw new ToolError(`${name} is required`);
  return text;
}

function readRegion(values) {
  if (values.length < 4) throw new ToolError('--region needs x y width height');
  const region = [
    coordinate(values[0], 'region x'),
    coordinate(values[1], 'region y'),
    coordinate(values[2], 'region width'),
    coordinate(values[3], 'region height'),
  ];
  if (region[2] <= 0 || region[3] <= 0) throw new ToolError('--region width and height must be positive');
  return region;
}

export function parseShotArgs(args) {
  const files = [];
  let region = null;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--region') {
      region = readRegion(args.slice(index + 1, index + 5));
      index += 4;
      continue;
    }
    if (argument.startsWith('--')) throw new ToolError(`unknown shot flag "${argument}"`);
    files.push(argument);
  }
  if (files.length > 1) throw new ToolError(`shot writes one file, got ${files.length} paths`);
  return { file: files[0], region };
}

function screenshotPath(target) {
  if (target) {
    const file = resolve(target);
    if (existsSync(file) && statSync(file).isDirectory()) {
      throw new ToolError(`${file} is a directory, not a file to write the screenshot to`);
    }
    mkdirSync(dirname(file), { recursive: true });
    return file;
  }
  const folder = temp('opencode-computer-use');
  mkdirSync(folder, { recursive: true });
  return join(folder, `shot-${Date.now()}.png`);
}

async function runShot(args) {
  const { file: target, region } = parseShotArgs(args);
  const file = screenshotPath(target);
  await ps(['shot', file, ...(region ?? []).map(String)]);
  const size = statSync(file).size;
  const floor = region ? MIN_REGION_BYTES : MIN_SCREENSHOT_BYTES;
  if (size < floor) {
    unlinkSync(file);
    throw new ToolError('capture returned an empty image — is the session locked or the display asleep?');
  }
  console.log(`SAVED ${file} ${size} bytes`);
}

async function runSee(args) {
  const question = validateVisionQuestion(args[0]);
  const { file: extra, region } = parseShotArgs(args.slice(1));
  if (extra) throw new ToolError('see takes a question and optional --region x y width height');
  await ensureVision();
  const file = screenshotPath();
  try {
    const output = await ps(['shot', file, ...(region ?? []).map(String)]);
    const captured = /CAPTURED (\d+)x(\d+) at (-?\d+),(-?\d+)/.exec(output);
    if (!captured) throw new ToolError('the screenshot returned no capture coordinates');
    console.log(await describeImage(file, question, { x: Number(captured[3]), y: Number(captured[4]) }));
  } finally { if (existsSync(file)) unlinkSync(file); }
}

export function parseReadArgs(args) {
  let region = null;
  let language = null;
  let json = false;
  const rest = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--region') {
      region = readRegion(args.slice(index + 1, index + 5));
      index += 4;
      continue;
    }
    if (argument === '--lang') {
      language = required(args[++index], 'a language tag like en-US or ru');
      continue;
    }
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument.startsWith('--')) throw new ToolError(`unknown read flag "${argument}"`);
    rest.push(argument);
  }
  if (rest.length > 0) throw new ToolError(`read takes flags only, got "${rest[0]}"`);
  return { region, language, json };
}

export function parseWindowArgs(args) {
  const rest = [];
  let depth = null;
  let pid = null;
  let title = null;
  let json = false;
  let all = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--all') {
      all = true;
      continue;
    }
    if (argument === '--depth') {
      depth = integer(args[++index], 'depth');
      if (depth < 1 || depth > MAX_TREE_DEPTH) throw new ToolError(`depth must be between 1 and ${MAX_TREE_DEPTH}`);
      continue;
    }
    if (argument === '--pid') {
      pid = integer(args[++index], 'pid');
      if (pid <= 0 || pid > 2147483647) throw new ToolError('pid must be between 1 and 2147483647');
      continue;
    }
    if (argument === '--title') {
      title = required(args[++index], 'a title substring');
      continue;
    }
    if (argument.startsWith('--')) throw new ToolError(`unknown flag "${argument}"`);
    rest.push(argument);
  }
  if (pid !== null && title !== null) throw new ToolError('--pid and --title both pick the window, pass one of them');
  return { rest, depth, pid, title, json, all };
}

function windowFlags(options) {
  return [
    ...(options.json ? ['-Json'] : []),
    ...(options.all ? ['-All'] : []),
    ...(options.depth === null || options.depth === undefined ? [] : ['-Depth', String(options.depth)]),
    ...(options.pid === null || options.pid === undefined ? [] : ['-TargetPid', String(options.pid)]),
    ...(options.title ? ['-TargetTitle', options.title] : []),
  ];
}

export function parseControlArgs(args, waiting = false) {
  const rest = [];
  let maxChars = 1000;
  let seconds = 10;
  let state = 'enabled';
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--max-chars' && !waiting) {
      maxChars = integer(args[++index], 'max chars');
      if (maxChars < 1 || maxChars > 2000) throw new ToolError('max chars must be between 1 and 2000');
    } else if (flag === '--seconds' && waiting) {
      const value = args[++index];
      seconds = value === undefined || !value.trim() ? Number.NaN : Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30)
        throw new ToolError('conditional wait seconds must be greater than 0 and at most 30');
    } else if (flag === '--state' && waiting) {
      state = oneOf(args[++index], ['exists', 'enabled'], 'control state');
    } else rest.push(flag);
  }
  const options = parseWindowArgs(rest);
  if (options.all || options.json || options.depth !== null)
    throw new ToolError('control inspection takes a name, window target and documented control flags only');
  return { ...options, needle: required(options.rest.join(' '), 'the name of the control'), maxChars, seconds, state };
}

async function runInspect(args) {
  const options = parseControlArgs(args);
  console.log(await ps(['inspect', options.needle, ...windowFlags(options), '-MaxChars', String(options.maxChars)]));
}

async function runWaitControl(args, { signal } = {}) {
  const options = parseControlArgs(args, true);
  const result = await waitForControl({
    seconds: options.seconds,
    state: options.state,
    signal,
    observe: async (timeout) => JSON.parse(await ps(['inspect', options.needle, ...windowFlags(options), '-MaxChars', '1000'], timeout)),
  });
  console.log(JSON.stringify(result));
}

async function runRead(args) {
  const { region, language, json } = parseReadArgs(args);
  console.log(
    await ps([
      'read',
      ...(region ?? []).map(String),
      ...(language ? ['-Language', language] : []),
      ...(json ? ['-Json'] : []),
    ]),
  );
}

async function runTree(args) {
  const options = parseWindowArgs(args);
  if (options.rest.length > 0) throw new ToolError(`tree takes flags only, got "${options.rest[0]}"`);
  console.log(await ps(['tree', ...windowFlags(options)]));
}

async function runFind(args) {
  const options = parseWindowArgs(args);
  const needle = required(options.rest.join(' '), 'the text to look for');
  console.log(await ps(['find', needle, ...windowFlags(options)]));
}

async function runTap(args) {
  const options = parseWindowArgs(args);
  if (options.json) throw new ToolError('tap reports what it clicked, it takes no --json');
  const needle = required(options.rest.join(' '), 'the name of the control to click');
  console.log(await input(['tap', needle, ...windowFlags(options)]));
}

async function runMove(args) {
  console.log(await input(['move', String(coordinate(args[0], 'x')), String(coordinate(args[1], 'y'))]));
}

async function runClick(args) {
  const mode = oneOf(args[2] ?? 'left', CLICK_MODES, 'click mode');
  console.log(await input(['click', String(coordinate(args[0], 'x')), String(coordinate(args[1], 'y')), mode]));
}

async function runDrag(args) {
  const from = [coordinate(args[0], 'x'), coordinate(args[1], 'y')];
  const to = [coordinate(args[2], 'to x'), coordinate(args[3], 'to y')];
  console.log(await input(['drag', ...from, ...to].map(String)));
}

async function runWheel(args) {
  const horizontal = args.includes('--horizontal');
  const position = args.filter((argument) => argument !== '--horizontal');
  const delta = integer(position[0], 'delta');
  if (delta < -2147483648 || delta > 2147483647) throw new ToolError('wheel delta exceeds a Windows signed integer');
  if (![1, 3].includes(position.length)) throw new ToolError('wheel needs a delta and either both x and y, or neither');
  if (delta === 0) throw new ToolError('wheel delta must not be zero');
  const [x, y] = position.slice(1);
  const target = x === undefined ? [] : [String(coordinate(x, 'x')), String(coordinate(y, 'y'))];
  console.log(await input(['wheel', String(delta), ...target, ...(horizontal ? ['--horizontal'] : [])]));
}

async function runType(args) {
  const text = args.join(' ');
  if (!text.length) throw new ToolError('type text is required');
  for (let index = 0; index < text.length; index += TYPE_CHUNK_CHARS) {
    requireIndicator();
    console.log(await input(['type', text.slice(index, index + TYPE_CHUNK_CHARS)]));
    if (index + TYPE_CHUNK_CHARS < text.length) await sleep(30);
  }
}

async function runKey(args) {
  const name = required(args[0], 'key name (Enter, Esc, Tab, Ctrl, F5, …)');
  console.log(await input(['key', name, oneOf(args[1] ?? '', KEY_PHASES, 'key phase')]));
}

async function runKeys(args) {
  const combo = required(args[0], 'a combination like ctrl+shift+t');
  if (!combo.includes('+')) throw new ToolError('keys needs a combination like ctrl+shift+t');
  console.log(await input(['keys', combo]));
}

async function runClipboard(args) {
  const action = oneOf(args[0] ?? 'get', CLIPBOARD_ACTIONS, 'clipboard action');
  if (action !== 'set') {
    console.log(await input(['clipboard', action]));
    return;
  }
  console.log(await input(['clipboard', 'set', required(args.slice(1).join(' '), 'clipboard text')]));
}

async function runWindows(args) {
  if (args[0] !== undefined && args[0] !== '--json') {
    throw new ToolError(`windows takes --json or nothing, got "${args[0]}"`);
  }
  console.log(await ps([args[0] === '--json' ? 'windows-json' : 'windows']));
}

async function runFocus(args) {
  if (args[0] === '--title') {
    console.log(await ps(['focus-title', required(args.slice(1).join(' '), 'a title substring')]));
    return;
  }
  console.log(await ps(['focus', String(integer(args[0], 'pid'))]));
}

async function runWaitWindow(args) {
  const title = required(args[0], 'a title substring');
  const seconds = args[1] ? integer(args[1], 'seconds') : 15;
  console.log(await ps(['wait-window', title, String(seconds)]));
}

async function runBroker(args) {
  const action = oneOf(args[0] ?? 'status', BROKER_ACTIONS, 'broker action');
  if (action !== 'status') requireIndicator();
  console.log(await ps([action === 'status' ? 'broker-state' : `broker-${action}`]));
}

async function runRun(args) {
  console.log(await input(['run', required(args.join(' '), 'a command line')], SLOW_BACKEND_TIMEOUT_MS));
}

export function parseOverlayFlags(args, environment = process.env) {
  const flags = new Set();
  let announce;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--announce') {
      announce = parseAnnounceSeconds(integer(args[++index], 'announce seconds'));
      continue;
    }
    if (!START_FLAGS.includes(argument) && !(argument in ONE_SHOT_FLAGS)) {
      throw new ToolError(`unknown overlay flag "${argument}"`);
    }
    flags.add(argument);
  }
  const oneShotFlags = [...flags].filter((flag) => flag in ONE_SHOT_FLAGS);
  if (oneShotFlags.length > 1) throw new ToolError('overlay takes either --stop or --restore-cursor, not both');
  const startFlags = [...flags].filter((flag) => START_FLAGS.includes(flag));
  if (oneShotFlags.length === 1 && startFlags.length > 0) {
    throw new ToolError(`${startFlags[0]} only applies while starting the indicator`);
  }
  return {
    announce: announce ?? (oneShotFlags.length ? DEFAULT_ANNOUNCE_SECONDS
      : parseAnnounceSeconds(environment.OPENCODE_CU_ANNOUNCE_SECONDS, 'OPENCODE_CU_ANNOUNCE_SECONDS')),
    quiet: flags.has('--quiet'),
    hideCursor: flags.has('--hide-cursor'),
    oneShot: oneShotFlags.length === 1 ? ONE_SHOT_FLAGS[oneShotFlags[0]] : null,
  };
}

async function runOverlay(args) {
  const options = parseOverlayFlags(args);
  if (options.oneShot) {
    console.log(await ps(['overlay', options.oneShot]));
    return;
  }
  forgetHumanStop();
  const extra = [
    ...(options.quiet ? ['-Quiet'] : []),
    ...(options.hideCursor ? ['-HideCursor'] : []),
  ];
  const state = await ps(['overlay-start', '-Announce', String(options.announce), ...extra]);
  if (!state.includes('RUNNING')) {
    throw new ToolError('the indicator did not come up — refusing to start input without it');
  }

  const deadline = Date.now() + (options.announce + 5) * 1000;
  while (!indicatorReady()) {
    if (!indicatorIsUp() || !indicatorProcessAlive()) {
      throw new ToolError('the indicator stopped during the announcement; input remains blocked');
    }
    if (Date.now() >= deadline) throw new ToolError('the indicator did not finish the countdown; input remains blocked');
    await sleep(50);
  }
  requireIndicator();
  console.log(`OVERLAY on (frame up, announced for ${options.announce}s)`);
}

async function runOverlayState() {
  console.log(indicatorIsUp() && indicatorProcessAlive() ? 'RUNNING' : 'STOPPED');
}

async function runDoctor() {
  const report = (label, value) => console.log(`${label.padEnd(12)}${value}`);
  const installed = (name) => {
    try {
      exec('where', [name]);
      return true;
    } catch {
      return false;
    }
  };
  report('platform:', `${process.platform} ${process.arch}${isWindows ? '' : '  (unsupported)'}`);
  report('node:', process.version);
  report('root:', root);
  report('powershell:', installed('powershell') ? 'ok' : 'MISSING (required)');
  report('backend:', existsSync(backendScript) ? 'present' : 'MISSING');
  report('indicator:', indicatorIsUp() ? 'RUNNING' : 'stopped');
  report('broker:', brokerIsUp() ? 'RUNNING (run is elevated)' : 'stopped');
  report('cursor:', await describeCursor());
  report('display:', await describeDisplay());
  report('skill:', describeSkillInstall());
  report('installs:', 'none — the backend compiles itself with the bundled .NET Framework');
  report('limits:', 'elevated windows (UIPI) and the secure desktop (UAC, lock screen)');
}

async function describeCursor() {
  if (cursorMayBeHidden()) {
    return indicatorIsUp()
      ? 'replaced by the marker (--hide-cursor)'
      : 'HIDDEN — the next command repairs it, or run "opencode-cu overlay --restore-cursor"';
  }
  try {
    const state = await ps(['cursor-state']);
    if (state.includes('CURSOR_HIDDEN_BY_OTHER')) {
      return 'hidden, but not by this tool (another program holds the pointer)';
    }
    return 'visible';
  } catch {
    return 'unknown';
  }
}

async function describeDisplay() {
  if (!isWindows || !existsSync(backendScript)) return 'unknown (not a Windows host)';
  try {
    return (await ps(['display'])).replace(/^DISPLAY\s+/, '');
  } catch (error) {
    return `unknown (${String(error.message).split('\n')[0]})`;
  }
}

function describeSkillInstall() {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const path = join(config, 'opencode', 'skills', 'opencode-computer-use', 'SKILL.md');
  return existsSync(path) ? `installed (${path})` : `not installed (${path}) - run install-opencode.ps1`;
}

async function runMcp() {
  const { serve } = await import('./mcp.js');
  serve();
  await new Promise(() => undefined);
}

async function runSelfTest() {
  const { runSelfTest: run } = await import('./selftest.js');
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  await run({ root, cli, exec });
}

export const COMMANDS = [
  {
    name: 'see',
    args: '<question> [--region <x> <y> <w> <h>]',
    summary: 'ask local vision about the screen; returns text for models without vision',
    run: runSee,
  },
  {
    name: 'shot',
    args: '[file.png] [--region <x> <y> <w> <h>]',
    summary: 'capture the primary screen, or a crop of it',
    run: runShot,
  },
  {
    name: 'read',
    args: '[--region <x> <y> <w> <h>] [--lang <tag>] [--json]',
    summary: 'read the screen as text with Windows OCR, each line with a clickable point',
    run: runRead,
  },
  {
    name: 'tree',
    args: '[--pid N | --title <text>] [--depth N] [--all] [--json]',
    summary: 'the control tree of a window: role, name and a clickable point',
    run: runTree,
  },
  {
    name: 'find',
    args: '<text> [--pid N | --title <text>] [--json]',
    summary: 'controls whose name or id contains the text',
    run: runFind,
  },
  {
    name: 'tap',
    args: '<text> [--pid N | --title <text>]',
    summary: 'click the one control named like that, or refuse and list the candidates',
    gated: true,
    run: runTap,
  },
  {
    name: 'inspect',
    args: '<text> [--pid N | --title <text>] [--max-chars N]',
    summary: 'read one unique control value and state as JSON; protected values stay hidden',
    run: runInspect,
  },
  {
    name: 'wait-control',
    args: '<text> [--pid N | --title <text>] [--seconds N] [--state exists|enabled]',
    summary: 'wait for one named control with bounded polling; no input or focus change',
    run: runWaitControl,
  },
  {
    name: 'move',
    args: '<x> <y>',
    summary: 'move the pointer',
    gated: true,
    run: runMove,
  },
  {
    name: 'click',
    args: '<x> <y> [left|right|middle|double|triple]',
    summary: 'click',
    gated: true,
    run: runClick,
  },
  {
    name: 'drag',
    args: '<x> <y> <to-x> <to-y>',
    summary: 'press at the first point, glide to the second, release',
    gated: true,
    run: runDrag,
  },
  {
    name: 'wheel',
    args: '<delta> [<x> <y>] [--horizontal]',
    summary: 'scroll, 120 = one notch, at that point when x y are given',
    gated: true,
    run: runWheel,
  },
  {
    name: 'type',
    args: '<text>',
    summary: 'type into the focused window',
    gated: true,
    run: runType,
  },
  {
    name: 'key',
    args: '<name> [down|up]',
    summary: 'Enter, Esc, Tab, Space, Ctrl, Alt, F1..F12, arrows',
    gated: (args) => args[1] !== 'up',
    run: runKey,
  },
  {
    name: 'keys',
    args: '<combo>',
    summary: 'ctrl+l, ctrl+shift+t, ...',
    gated: true,
    run: runKeys,
  },
  {
    name: 'clipboard',
    args: '[get|set <text>|clear]',
    summary: 'read or write the clipboard',
    gated: true,
    run: runClipboard,
  },
  {
    name: 'pos',
    args: '',
    summary: 'pointer position and foreground window',
    run: async () => console.log(await ps(['pos'])),
  },
  {
    name: 'windows',
    args: '[--json]',
    summary: 'visible windows with pid, title and rectangle',
    run: runWindows,
  },
  {
    name: 'focus',
    args: '<pid> | --title <text>',
    summary: 'bring a window to the front, verified',
    gated: true,
    run: runFocus,
  },
  {
    name: 'wait-window',
    args: '<text> [seconds]',
    summary: 'wait for a window to appear, then focus it',
    gated: true,
    run: runWaitWindow,
  },
  {
    name: 'run',
    args: '<command line>',
    summary: 'run a command line (elevated when the broker is up)',
    gated: true,
    run: runRun,
  },
  {
    name: 'broker',
    args: '[start|stop|status]',
    summary: 'elevated input broker, asks for UAC',
    run: runBroker,
  },
  {
    name: 'overlay',
    args: '[--announce N] [--quiet] [--hide-cursor]',
    summary: 'on-screen indicator, ESC stops it; --hide-cursor makes the marker replace the pointer',
    run: runOverlay,
  },
  {
    name: 'overlay-state',
    args: '',
    summary: 'whether the indicator is running',
    run: runOverlayState,
  },
  {
    name: 'display',
    args: '',
    summary: 'primary screen size and DPI',
    run: async () => console.log(await ps(['display'])),
  },
  {
    name: 'mcp',
    args: '',
    summary: 'serve OpenCode desktop tools over MCP stdio',
    run: runMcp,
  },
  {
    name: 'doctor',
    args: '',
    summary: 'what this machine can do',
    windowsOnly: false,
    run: runDoctor,
  },
  {
    name: 'self-test',
    args: '',
    summary: 'test isolated Windows/MCP scenarios, save a JSON report',
    windowsOnly: false,
    run: runSelfTest,
  },
];

export function renderHelp() {
  const lines = COMMANDS.map((command) => `  opencode-cu ${command.name} ${command.args}`.trimEnd());
  const width = Math.max(...lines.map((line) => line.length));
  const rows = COMMANDS.map(
    (command, index) => `${lines[index]}${' '.repeat(width - lines[index].length + 4)}${command.summary}`,
  );
  return `opencode-cu — computer use for agents (Windows)

${rows.join('\n')}

Also:
  opencode-cu overlay --stop                     stop the indicator, restore the cursor
  opencode-cu overlay --restore-cursor           emergency cursor rescue

Nothing to install: the backend compiles its own C# with the .NET Framework that ships with
Windows. Elevated windows (UIPI) and the secure desktop (UAC, lock screen) are unreachable.`;
}

export function findCommand(name) {
  const command = COMMANDS.find((entry) => entry.name === name);
  if (!command) throw new ToolError(`unknown command "${name}" — run opencode-cu --help`);
  return command;
}

export function commandIsGated(command, args) {
  return typeof command.gated === 'function' ? command.gated(args) : Boolean(command.gated);
}
