import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildOpenCodePackage, verifyOpenCodePackage } from '../src/package-opencode.js';
import { checkContract } from '../src/contract.js';

const folders = [];
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'dsh-cu-package-'));
  folders.push(folder);
  return folder;
}

after(() => {
  for (const folder of folders) {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith('dsh-cu-package-'));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('GitHub export contains a complete portable English repository and passes the shared contract', () => {
  const parent = fixture();
  const output = join(parent, 'release folder with spaces');
  const result = buildOpenCodePackage({ outputDir: output });
  assert.equal(verifyOpenCodePackage(result.directory).valid, true);
  assert.deepEqual(checkContract(result.directory), []);
  const manifest = JSON.parse(readFileSync(join(result.directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'dsh-cu');
  assert.equal(manifest.private, true);
  assert.equal(manifest.repository.url, 'git+https://github.com/datuloar/open-code-computer-use-win.git');
  assert.equal(manifest.dependencies, undefined);
  for (const path of manifest.files) assert.ok(existsSync(join(result.directory, path)), path);
  const inventory = JSON.parse(readFileSync(result.manifest, 'utf8')).files;
  assert.ok(inventory.some((file) => file.path === '.github/workflows/release.yml'));
  assert.ok(inventory.some((file) => file.path === 'test/opencode-fixture-guard.js'));
  assert.ok(!inventory.some((file) => /(?:^|\/)(?:\.git|node_modules|backups)(?:\/|$)/.test(file.path)));
  for (const entry of inventory) {
    assert.ok(!isAbsolute(entry.path));
    if (!entry.path.endsWith('.md')) continue;
    const body = readFileSync(join(result.directory, entry.path), 'utf8');
    assert.doesNotMatch(body, /[\u0400-\u04ff]|[a-z]:\\Users\\[^\\]+/i);
    if (entry.path.startsWith('packaging/')) continue;
    for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (link && !/^[a-z]+:/i.test(link)) assert.ok(existsSync(resolve(result.directory, dirname(entry.path), link)), `${entry.path}: ${link}`);
    }
  }
  assert.match(readFileSync(join(result.directory, 'README.md'), 'utf8'), /# OpenCode Computer Use/);
  assert.doesNotMatch(readFileSync(join(result.directory, 'README.md'), 'utf8'), /\{\{CLI_REFERENCE\}\}/);
  assert.ok(!existsSync(join(result.directory, 'opencode.json')));
});

test('package export preserves existing paths and rejects invalid destinations or GitHub metadata', () => {
  const parent = fixture();
  const marker = join(parent, 'keep.txt');
  writeFileSync(marker, 'keep');
  assert.throws(() => buildOpenCodePackage({ outputDir: parent }), /already exists/);
  assert.equal(readFileSync(marker, 'utf8'), 'keep');
  for (const repository of ['https://github.com/owner/repo', '../outside', 'owner/repo/extra', 'owner/..'])
    assert.throws(() => buildOpenCodePackage({ outputDir: join(parent, 'bad'), repository }), /owner\/repository/);
  assert.ok(!existsSync(join(parent, 'bad')));
  assert.throws(() => buildOpenCodePackage({ outputDir: fileURLToPath(new URL('../src/forbidden-package', import.meta.url)) }), /source directory/);
});

test('package integrity detects altered content, extra files and manifest traversal before reading outside', () => {
  const parent = fixture();
  const result = buildOpenCodePackage({ outputDir: join(parent, 'export'), repository: 'example-owner/computer-use' });
  const manifest = JSON.parse(readFileSync(join(result.directory, 'package.json'), 'utf8'));
  assert.equal(manifest.repository.url, 'git+https://github.com/example-owner/computer-use.git');
  const readme = join(result.directory, 'README.md');
  const original = readFileSync(readme);
  writeFileSync(readme, 'changed');
  assert.throws(() => verifyOpenCodePackage(result.directory), /integrity mismatch: README.md/);
  writeFileSync(readme, original);
  const extra = join(result.directory, '.env');
  writeFileSync(extra, 'fixture only');
  assert.throws(() => verifyOpenCodePackage(result.directory), /unexpected file/);
  rmSync(extra);
  const inventory = JSON.parse(readFileSync(result.manifest, 'utf8'));
  inventory.files[0].path = '../outside';
  writeFileSync(result.manifest, JSON.stringify(inventory));
  assert.throws(() => verifyOpenCodePackage(result.directory), /invalid package manifest path/);
});

test('a source directory junction cannot pull files into an export', () => {
  const parent = fixture();
  const source = join(parent, 'source');
  const outside = join(parent, 'outside');
  mkdirSync(source);
  mkdirSync(outside);
  writeFileSync(join(source, 'package.json'), '{"version":"1.0.0"}');
  writeFileSync(join(outside, 'private.js'), 'fixture');
  symlinkSync(outside, join(source, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildOpenCodePackage({ root: source, outputDir: join(parent, 'export') }), /symlinks cannot be packaged/);
  assert.ok(!existsSync(join(parent, 'export')));
});

test('a fresh exported copy installs, repeats and uninstalls from a path with spaces', async () => {
  const parent = fixture();
  const result = buildOpenCodePackage({ outputDir: join(parent, 'release with spaces') });
  const { installOpenCode, parseConfig } = await import(pathToFileURL(join(result.directory, 'src/install-opencode.js')).href);
  const configDir = join(parent, 'fresh config');
  const configPath = join(configDir, 'opencode.jsonc');
  mkdirSync(configDir);
  writeFileSync(configPath, '{"model":"example/model","provider":{"fixture":{"options":{"apiKey":"test-only"}}},"mcp":{"existing":{"type":"remote","url":"https://example.invalid/mcp"}}}');
  const before = parseConfig(readFileSync(configPath, 'utf8'));
  const installed = installOpenCode({ configDir, configPath });
  const config = parseConfig(readFileSync(configPath, 'utf8'));
  assert.equal(config.mcp.computer.command[0], process.execPath);
  assert.equal(config.mcp.computer.command[1], join(result.directory, 'opencode/mcp.js'));
  assert.equal(config.plugin[0][0], pathToFileURL(join(result.directory, 'opencode/plugin.js')).href);
  assert.deepEqual(config.provider, before.provider);
  assert.deepEqual(config.mcp.existing, before.mcp.existing);
  assert.equal(config.model, before.model);
  assert.ok(installed.backups && existsSync(installed.skill));
  assert.equal(installOpenCode({ configDir, configPath }).backups, null);
  installOpenCode({ configDir, configPath, uninstall: true });
  const removed = parseConfig(readFileSync(configPath, 'utf8'));
  assert.deepEqual(removed.mcp, before.mcp);
  assert.equal(removed.plugin.length, 0);
  assert.equal(removed.model, before.model);
  assert.ok(!existsSync(installed.skill));
  assert.ok(readdirSync(join(configDir, 'backups/computer-use')).length >= 1);
  assert.ok(!relative(parent, result.directory).startsWith('..'));
});
