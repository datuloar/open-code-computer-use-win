import { spawn } from 'node:child_process';
import { ToolError } from './tool-error.js';

const END = 'DSH-CU-END';
const START_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;

export class BackendHost {
  constructor({ command, args, spawnProcess = spawn, startTimeoutMs = START_TIMEOUT_MS }) {
    this.command = command;
    this.args = args;
    this.spawnProcess = spawnProcess;
    this.startTimeoutMs = startTimeoutMs;
    this.child = null;
    this.buffer = '';
    this.pending = null;
    this.ready = null;
    this.startup = null;
    this.stderr = '';
    this.queue = Promise.resolve();
  }

  call(argv, timeoutMs = CALL_TIMEOUT_MS) {
    const run = this.queue.then(() => this.send(argv, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async send(argv, timeoutMs) {
    await this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill(
          new ToolError(
            `the backend was stopped after ${Math.round(timeoutMs / 1000)}s; the machine is busy or a dialog is waiting`,
          ),
        );
      }, timeoutMs);
      const pending = {
        lines: [],
        chars: 0,
        finish: (status) => {
          clearTimeout(timer);
          const output = pending.lines.join('\n').trim();
          this.pending = null;
          if (status === '0') resolve(output);
          else reject(new ToolError(output || `the backend failed with status ${status} and said nothing`));
        },
        fail: (error) => {
          clearTimeout(timer);
          this.pending = null;
          reject(error);
        },
      };
      this.pending = pending;
      try {
        this.child.stdin.write(`${JSON.stringify(argv)}\n`);
      } catch (error) {
        this.kill(new ToolError(`the backend input pipe failed: ${error.message}`));
      }
    });
  }

  start() {
    if (this.ready) return this.ready;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.ready = ready;
    this.startup = { resolve: resolveReady, reject: rejectReady, timer: null };
    try {
      const child = this.spawnProcess(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      this.buffer = '';
      this.stderr = '';
      this.startup.timer = setTimeout(() => {
        this.kill(this.failure(`the backend did not start within ${this.startTimeoutMs / 1000}s`));
      }, this.startTimeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding?.('utf8');
      child.stdout.on('data', (chunk) => {
        if (this.child !== child) return;
        this.receive(chunk);
      });
      child.stderr.on('data', (chunk) => {
        if (this.child === child) this.stderr = (this.stderr + String(chunk)).slice(-4096);
      });
      child.on('error', (error) => {
        if (this.child !== child) return;
        this.kill(this.failure(`the backend could not start: ${error.message}`));
      });
      child.on('exit', (code) => {
        if (this.child !== child) return;
        const error = this.failure(`the backend exited (${code ?? 'killed'}) before completing startup or a command`);
        this.reset(error);
      });
      child.stdin.on('error', (error) => {
        if (this.child !== child) return;
        this.kill(new ToolError(`the backend input pipe failed: ${error.message}`));
      });
    } catch (error) {
      this.kill(new ToolError(`the backend could not start: ${error.message}`));
    }
    return ready;
  }

  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length + (this.pending?.chars ?? 0) > MAX_OUTPUT_CHARS) {
      this.kill(new ToolError('the backend output exceeded 16 MB; narrow the requested region or window'));
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line === `${END} READY` || line === `${END} 0` || line === `${END} 1`) {
        const status = line.slice(END.length).trim();
        if (status === 'READY' && this.startup) {
          const startup = this.startup;
          this.startup = null;
          clearTimeout(startup.timer);
          startup.resolve();
        }
        else this.pending?.finish(status);
      } else {
        if (this.pending) {
          this.pending.lines.push(line);
          this.pending.chars += line.length + 1;
        }
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  reset(error) {
    this.child = null;
    this.ready = null;
    this.buffer = '';
    if (this.startup) {
      clearTimeout(this.startup.timer);
      this.startup.reject(error);
      this.startup = null;
    }
    this.pending?.fail(error);
  }

  failure(message) {
    return new ToolError(this.stderr.trim() ? `${message}: ${this.stderr.trim()}` : message);
  }

  kill(error = new ToolError('the backend was stopped before completing startup or a command')) {
    const child = this.child;
    this.reset(error);
    if (!child) return;
    try {
      child.stdin.end();
      child.kill();
    } catch {
      return;
    }
  }
}
