#!/usr/bin/env node

import { existsSync } from 'node:fs';
import {
  backendScript,
  cursorMayBeHidden,
  indicatorProcessAlive,
  isWindows,
  ps,
  requireIndicator,
} from './backend.js';
import { commandIsGated, findCommand, renderHelp } from './commands.js';
import { ToolError } from './tool-error.js';

const HELP_FLAGS = ['help', '--help', '-h'];

function fail(message) {
  console.error(`opencode-cu: ${message}`);
  process.exit(1);
}

async function repairStrandedCursor() {
  if (!isWindows || !cursorMayBeHidden() || indicatorProcessAlive()) return;
  try {
    await ps(['overlay', 'restore-cursor']);
    console.error('opencode-cu: the pointer had been left hidden by an interrupted indicator — restored it');
  } catch {
    console.error('opencode-cu: the pointer looks hidden and could not be restored — run "opencode-cu overlay --restore-cursor"');
  }
}

function refuseOffWindows() {
  fail(
    `this toolkit is Windows only (running on ${process.platform}).\n` +
      'The indicator, SendInput and cursor handling have no verified equivalent here, and a\n' +
      'command that silently does nothing is worse than this message.',
  );
}

async function main(argv) {
  const [name, ...args] = argv;
  if (!name || HELP_FLAGS.includes(name)) {
    console.log(renderHelp());
    return;
  }

  await repairStrandedCursor();

  const command = findCommand(name);
  if (command.windowsOnly !== false) {
    if (!isWindows) refuseOffWindows();
    if (!existsSync(backendScript)) fail(`backend missing: ${backendScript}`);
  }
  if (commandIsGated(command, args)) requireIndicator();

  await command.run(args);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof ToolError) fail(error.message);
  fail(`${error.message}\n${error.stack ?? ''}`.trim());
}
