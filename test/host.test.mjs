import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BackendHost } from '../src/host.js';

function child() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stdout.setEncoding = () => {};
  process.stderr = new EventEmitter();
  process.stdin = new EventEmitter();
  process.stdin.end = () => {};
  process.stdin.write = () => {};
  process.kill = () => {};
  return process;
}

test('an exit before READY rejects startup instead of leaving it pending', async () => {
  const process = child();
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => process });
  const starting = host.start();
  process.emit('exit', 1);
  await assert.rejects(starting, /before completing startup/);
  assert.equal(host.ready, null);
});

test('late output and exit from a killed host cannot corrupt its replacement', async () => {
  const old = child();
  const next = child();
  const children = [old, next];
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => children.shift() });
  const first = host.start();
  old.stdout.emit('data', '\u001eDSH-CU-END READY\n');
  await first;
  host.kill();
  const second = host.start();
  old.stdout.emit('data', 'stale partial output');
  old.emit('exit', 0);
  next.stdout.emit('data', '\u001eDSH-CU-END READY\n');
  await second;
  next.stdin.write = () => queueMicrotask(() => next.stdout.emit('data', 'WINDOWS\n\u001eDSH-CU-END 0\n'));
  assert.equal(await host.call(['windows'], 1000), 'WINDOWS');
  host.kill();
});

test('a broken input pipe rejects the command and resets the host', async () => {
  const process = child();
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => process });
  const starting = host.start();
  process.stdout.emit('data', '\u001eDSH-CU-END READY\n');
  await starting;
  process.stdin.write = () => queueMicrotask(() => process.stdin.emit('error', new Error('EPIPE')));
  await assert.rejects(host.call(['windows'], 1000), /input pipe failed/);
  assert.equal(host.child, null);
});

test('a synchronous spawn failure does not poison the next startup', async () => {
  const next = child();
  let attempts = 0;
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => {
    if (attempts++ === 0) throw new Error('ENOENT');
    return next;
  } });
  await assert.rejects(host.start(), /ENOENT/);
  assert.equal(host.ready, null);
  const starting = host.start();
  next.stdout.emit('data', '\u001eDSH-CU-END READY\n');
  await starting;
  host.kill();
});

test('stopping a host settles startup and an in-flight command immediately', async () => {
  const process = child();
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => process });
  const first = host.start();
  host.kill();
  await assert.rejects(first, /stopped/);
  const second = host.start();
  process.stdout.emit('data', '\u001eDSH-CU-END READY\n');
  await second;
  const pending = host.call(['windows'], 1000);
  await new Promise((done) => setImmediate(done));
  host.kill();
  await assert.rejects(pending, /stopped/);
});

test('startup diagnostics survive an early exit and a startup timeout resets the host', async () => {
  const process = child();
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => process, startTimeoutMs: 10 });
  const first = host.start();
  process.stderr.emit('data', 'C# compilation failed');
  process.emit('exit', 1);
  await assert.rejects(first, /C# compilation failed/);
  await assert.rejects(host.start(), /did not start within/);
  assert.equal(host.ready, null);
  assert.equal(host.child, null);
});

test('synchronous pipe errors and command timeouts allow a later command to recover', async () => {
  const process = child();
  const host = new BackendHost({ command: 'fake', args: [], spawnProcess: () => process });
  const start = async () => {
    const ready = host.start();
    process.stdout.emit('data', '\u001eDSH-CU-END READY\n');
    await ready;
  };
  await start();
  process.stdin.write = () => { throw new Error('broken pipe'); };
  await assert.rejects(host.call(['windows'], 1000), /input pipe failed/);
  await start();
  process.stdin.write = () => {};
  await assert.rejects(host.call(['windows'], 10), /stopped after/);
  await start();
  process.stdin.write = () => queueMicrotask(() => process.stdout.emit('data', 'OK\r\n\u001eDSH-CU-END 0\n'));
  assert.equal(await host.call(['windows']), 'OK');
  host.kill();
});
