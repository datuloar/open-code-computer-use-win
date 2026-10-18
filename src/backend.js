import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { ToolError } from './tool-error.js';

const here = dirname(fileURLToPath(import.meta.url));

export const root = resolve(here, '..');

export const visionHome = () => join(process.env.LOCALAPPDATA || tmpdir(), 'dsh-cu', 'vision');

export async function startVisionServer() {
  const folder = visionHome();
  const executable = join(folder, 'runtime', 'llama-server.exe');
  if (![executable, join(folder, 'model.gguf'), join(folder, 'mmproj.gguf')].every(existsSync))
    throw new ToolError('Local vision is not installed. Run powershell -ExecutionPolicy Bypass -File install-vision.ps1');
  const log = openSync(join(folder, 'server.log'), 'a');
  try {
    const child = spawn(executable, ['-m', join(folder, 'model.gguf'), '--mmproj', join(folder, 'mmproj.gguf'),
      '--host', '127.0.0.1', '--port', '19471', '-ngl', '99', '-c', '8192', '-np', '1',
      '--alias', 'dsh-vision', '--jinja', '--sleep-idle-seconds', '300'], { detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { closeSync(log); }
}

export const backendScript = join(root, 'backends', 'windows.ps1');

export const isWindows = process.platform === 'win32';

export const FRESH_SECONDS = 5;

export const BACKEND_TIMEOUT_MS = 60_000;
export const SLOW_BACKEND_TIMEOUT_MS = 300_000;

const MAX_ARGUMENT_BYTES = 30_000;
const BROKER_POLL_MS = 40;
const POWERSHELL_FLAGS = [
  '-NoProfile',
  '-NonInteractive',
  '-NoLogo',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  backendScript,
];

export const temp = (name) => join(tmpdir(), name);

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function waitSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function ageSeconds(name) {
  try {
    return (Date.now() - statSync(temp(name)).mtimeMs) / 1000;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function exec(file, args, extraEnv, timeoutMs = BACKEND_TIMEOUT_MS) {
  const options = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
  };
  if (extraEnv) options.env = { ...process.env, ...extraEnv };
  try {
    return execFileSync(file, args, options).trim();
  } catch (error) {
    if (error.code === 'EPERM' && error.status == null) return execThroughFile(file, args, extraEnv, timeoutMs);
    throw backendFailure(error, timeoutMs);
  }
}

function backendFailure(error, timeoutMs) {
  const stdout = String(error.stdout ?? '').trim();
  const stderr = String(error.stderr ?? '').trim();
  if (error.signal || error.code === 'ETIMEDOUT') {
    return new ToolError(
      `the backend was stopped after ${Math.round(timeoutMs / 1000)}s (${error.signal || 'timeout'}); ` +
        'the machine is busy or a dialog is waiting',
    );
  }
  if (stdout || stderr) return new ToolError(stdout || stderr);
  return new ToolError(`the backend failed to start (${error.code ?? 'unknown'}) and said nothing`);
}

function execThroughFile(file, args, extraEnv, timeoutMs) {
  const capture = temp(`dsh-cu.capture-${process.pid}`);
  const descriptor = openSync(capture, 'w+');
  let status = 0;
  try {
    const options = { stdio: ['ignore', descriptor, descriptor], windowsHide: true, timeout: timeoutMs };
    if (extraEnv) options.env = { ...process.env, ...extraEnv };
    execFileSync(file, args, options);
  } catch (error) {
    if (error.status == null) {
      closeSync(descriptor);
      removeQuietly(capture);
      throw backendFailure(error, timeoutMs);
    }
    status = error.status;
  }
  closeSync(descriptor);
  let output = '';
  try {
    output = readFileSync(capture, 'utf8');
  } finally {
    removeQuietly(capture);
  }
  if (status !== 0) throw new ToolError(output.trim() || `the backend exited with ${status} and said nothing`);
  return output.trim();
}

function removeQuietly(path) {
  try {
    unlinkSync(path);
  } catch {
    return;
  }
}

export function touch() {
  try {
    writeFileSync(temp('dsh-cu.touch'), new Date().toISOString());
  } catch {
    return;
  }
}

let host = null;

export function powershell() {
  return process.env.DSH_CU_POWERSHELL || 'powershell';
}

export function serveCommand() {
  return { command: powershell(), args: [...POWERSHELL_FLAGS, 'serve'] };
}

export function useHost(instance) {
  host = instance;
}

export async function ps(args, timeoutMs = BACKEND_TIMEOUT_MS) {
  touch();
  const payload = JSON.stringify(args);
  if (payload.length > MAX_ARGUMENT_BYTES) {
    throw new ToolError(
      `this argument is too long for one call (${payload.length} bytes) — split it into smaller steps`,
    );
  }
  if (host) return host.call(args, timeoutMs);
  return exec(powershell(), POWERSHELL_FLAGS, { DSH_CU_ARGV: payload }, timeoutMs);
}

export function indicatorIsUp() {
  return ageSeconds('dsh-cu.alive') < FRESH_SECONDS;
}

export function indicatorProcessAlive() {
  const recorded = indicatorPid();
  if (recorded === null) return indicatorIsUp();
  try {
    process.kill(recorded, 0);
    return true;
  } catch {
    return false;
  }
}

function indicatorPid() {
  try {
    const recorded = Number.parseInt(readFileSync(temp('dsh-cu.pid'), 'utf8').trim().split(/\s+/)[0], 10);
    return Number.isInteger(recorded) && recorded > 0 ? recorded : null;
  } catch {
    return null;
  }
}

export function brokerIsUp() {
  return ageSeconds('dsh-cu.broker.ready') < FRESH_SECONDS;
}

export function humanStopSeconds() {
  return ageSeconds('dsh-cu.cancelled');
}

export function forgetHumanStop() {
  removeQuietly(temp('dsh-cu.cancelled'));
}

export function cursorMayBeHidden() {
  return Number.isFinite(ageSeconds('dsh-cu.cursor'));
}

export function requireIndicator() {
  if (process.env.DSH_CU_ALLOW_NO_INDICATOR === '1') return;
  if (indicatorIsUp() && process.env.DSH_CU_OWNER && indicatorOwner() !== process.env.DSH_CU_OWNER)
    throw new ToolError('another computer-use client owns the desktop; wait for it to stop');
  if (indicatorIsUp() && indicatorProcessAlive() && humanStopSeconds() >= 600) {
    if (indicatorReady()) return;
    throw new ToolError('the on-screen countdown is still running; wait for the announcement to finish');
  }
  throw new ToolError(
    'the on-screen indicator is not running, so the human cannot see or stop this.\n' +
      'Start it with "dsh-cu overlay" first, or set DSH_CU_ALLOW_NO_INDICATOR=1 to override.',
  );
}

export function indicatorReady() {
  try {
    const owner = readFileSync(temp('dsh-cu.pid'), 'utf8').trim();
    return owner.length > 0 && readFileSync(temp('dsh-cu.ready'), 'utf8').trim() === owner;
  } catch {
    return false;
  }
}

export function indicatorOwner() {
  try { return readFileSync(temp('dsh-cu.owner'), 'utf8').trim(); }
  catch { return ''; }
}

export function requestIndicatorStop(owner) {
  if (!owner || indicatorOwner() !== owner) return false;
  try { writeFileSync(temp('dsh-cu.stop'), `owner ${owner}`); return true; }
  catch { return false; }
}

export function checkedOutput(output) {
  const text = String(output).trim();
  if (/^ERROR(?:\s|$)/m.test(text)) throw new ToolError(text);
  return text;
}

function answerFromBroker(args, timeoutMs) {
  const requestFile = temp(`dsh-cu.broker.req.${process.pid}`);
  const responseFile = temp(`dsh-cu.broker.res.${process.pid}`);
  const stagedFile = `${requestFile}.tmp`;
  removeQuietly(responseFile);
  try {
    writeFileSync(stagedFile, JSON.stringify(args));
    renameSync(stagedFile, requestFile);
  } finally {
    removeQuietly(stagedFile);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let answer;
    try { answer = readFileSync(responseFile, 'utf8'); } catch { }
    if (answer !== undefined) {
      removeQuietly(responseFile);
      return checkedOutput(answer);
    }
    waitSync(BROKER_POLL_MS);
  }
  if (existsSync(requestFile)) {
    removeQuietly(requestFile);
    throw new ToolError(`the elevated broker did not answer within ${Math.round(timeoutMs / 1000)}s`);
  }
  const stuck = new ToolError(
    `the elevated broker took the command but did not answer within ${Math.round(timeoutMs / 1000)}s — ` +
      'it may still be running it, so this command is not retried',
  );
  stuck.consumed = true;
  throw stuck;
}

export function brokerTimeoutMs(args, requestedMs) {
  if (requestedMs) return requestedMs;
  return Math.min(120_000, 5_000 + JSON.stringify(args).length * 30);
}

export async function input(args, timeoutMs) {
  if (!brokerIsUp()) return ps(args, timeoutMs);
  return answerFromBroker(args, brokerTimeoutMs(args, timeoutMs));
}
