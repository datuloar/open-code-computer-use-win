import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDS,
  commandIsGated,
  findCommand,
  parseOverlayFlags,
  parseReadArgs,
  parseShotArgs,
  parseWindowArgs,
  renderHelp,
} from '../src/commands.js';

test('command names are unique, kebab-case and documented for --help', () => {
  const names = COMMANDS.map((command) => command.name);
  assert.equal(new Set(names).size, names.length, 'two commands share a name');
  for (const command of COMMANDS) {
    assert.match(command.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof command.run, 'function', `${command.name} has no handler`);
    assert.ok(command.summary, `${command.name} has no summary`);
  }
});

test('the help lists every command and no command that does not exist', () => {
  const help = renderHelp();
  const names = new Set(COMMANDS.map((command) => command.name));
  for (const name of names) {
    assert.ok(help.includes(`dsh-cu ${name}`), `${name} is missing from --help`);
  }
  for (const [, mentioned] of help.matchAll(/dsh-cu ([a-z][a-z-]*)/g)) {
    assert.ok(names.has(mentioned), `--help mentions "dsh-cu ${mentioned}", which does not exist`);
  }
});

test('only the command that injects input is gated', () => {
  const gated = COMMANDS.filter((command) => command.gated).map((command) => command.name).sort();
  assert.deepEqual(gated, ['click', 'clipboard', 'drag', 'focus', 'key', 'keys', 'move', 'run', 'tap', 'type', 'wait-window', 'wheel']);
});

test('doctor and self-test are the only commands that run off Windows', () => {
  const portable = COMMANDS.filter((command) => command.windowsOnly === false).map((command) => command.name).sort();
  assert.deepEqual(portable, ['doctor', 'self-test']);
});

test('findCommand rejects an unknown name with a helpful message', () => {
  assert.throws(() => findCommand('nope'), /unknown command "nope"/);
});

test('findCommand returns the table entry', () => {
  assert.equal(findCommand('shot').name, 'shot');
});

test('key releases are allowed when the indicator is gone, while key presses remain gated', () => {
  const key = findCommand('key');
  assert.equal(commandIsGated(key, ['Ctrl', 'up']), false);
  assert.equal(commandIsGated(key, ['Ctrl', 'down']), true);
  assert.equal(commandIsGated(key, ['Enter']), true);
  assert.throws(() => parseWindowArgs(['--pid', '0']), /pid must be between/);
  assert.throws(() => parseWindowArgs(['--pid', '9999999999999999999']), /safe integer/);
});

test('overlay flags parse into announce seconds and the one-shot actions', () => {
  assert.deepEqual(parseOverlayFlags([]), { announce: 8, quiet: false, hideCursor: false, oneShot: null });
  assert.deepEqual(parseOverlayFlags(['--announce', '0', '--hide-cursor']), {
    announce: 0,
    quiet: false,
    hideCursor: true,
    oneShot: null,
  });
  assert.equal(parseOverlayFlags(['--stop']).oneShot, 'stop');
  assert.equal(parseOverlayFlags(['--restore-cursor']).oneShot, 'restore-cursor');
});

test('overlay rejects nonsense, out-of-range announcements and mixed intents', () => {
  assert.throws(() => parseOverlayFlags(['--nonsense']), /unknown overlay flag/);
  assert.throws(() => parseOverlayFlags(['--announce', '99']), /between 0 and 30/);
  assert.throws(() => parseOverlayFlags(['--announce', 'soon']), /must be an integer/);
  assert.throws(() => parseOverlayFlags(['--stop', '--restore-cursor']), /not both/);
  assert.throws(() => parseOverlayFlags(['--stop', '--quiet']), /only applies while starting/);
  assert.throws(() => parseOverlayFlags(['--stop', '--hide-cursor']), /only applies while starting/);
});

test('shot takes one path, an optional region, and nothing else', () => {
  assert.deepEqual(parseShotArgs([]), { file: undefined, region: null });
  assert.deepEqual(parseShotArgs(['out.png']), { file: 'out.png', region: null });
  assert.deepEqual(parseShotArgs(['out.png', '--region', '10', '20', '30', '40']), {
    file: 'out.png',
    region: [10, 20, 30, 40],
  });
  assert.throws(() => parseShotArgs(['--region', '10', '20']), /--region needs x y width height/);
  assert.throws(() => parseShotArgs(['--region', '10', '20', '0', '40']), /must be positive/);
  assert.throws(() => parseShotArgs(['--region', '10', '20', '30', 'tall']), /must be an integer/);
  assert.throws(() => parseShotArgs(['--crop']), /unknown shot flag/);
  assert.throws(() => parseShotArgs(['one.png', 'two.png']), /writes one file/);
});

test('read takes a region, a language and --json, nothing positional', () => {
  assert.deepEqual(parseReadArgs([]), { region: null, language: null, json: false });
  assert.deepEqual(parseReadArgs(['--region', '1', '2', '3', '4', '--lang', 'en-US', '--json']), {
    region: [1, 2, 3, 4],
    language: 'en-US',
    json: true,
  });
  assert.throws(() => parseReadArgs(['--lang']), /language tag/);
  assert.throws(() => parseReadArgs(['stray']), /flags only/);
  assert.throws(() => parseReadArgs(['--zoom', '2']), /unknown read flag/);
});

test('window flags pick one window and bound the depth', () => {
  assert.deepEqual(parseWindowArgs(['Save', 'as', '--title', 'Notepad', '--json']), {
    rest: ['Save', 'as'],
    depth: null,
    pid: null,
    title: 'Notepad',
    json: true,
    all: false,
  });
  assert.equal(parseWindowArgs(['--pid', '42', '--depth', '3']).pid, 42);
  assert.throws(() => parseWindowArgs(['--pid', '1', '--title', 'x']), /pass one of them/);
  assert.throws(() => parseWindowArgs(['--depth', '0']), /between 1 and 20/);
  assert.throws(() => parseWindowArgs(['--depth', '99']), /between 1 and 20/);
  assert.throws(() => parseWindowArgs(['--everything']), /unknown flag/);
});
