import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkContract } from '../src/contract.js';
import { readField, readFrontmatter } from '../src/frontmatter.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = [];
function packageFixture() {
  const folder = mkdtempSync(join(tmpdir(), 'opencode-cu-contract-'));
  fixtures.push(folder);
  for (const file of ['README.md', 'package.json', 'install-opencode.ps1', 'opencode/plugin.js', 'opencode/mcp.js',
    'opencode/SKILL.md', 'opencode/INSTRUCTIONS.md', 'src/cli.js', 'src/opencode.js', 'src/install-opencode.js',
    'backends/windows.ps1', 'bin/opencode-cu.cmd']) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    copyFileSync(join(root, file), join(folder, file));
  }
  return folder;
}

after(() => { for (const folder of fixtures) rmSync(folder, { recursive: true, force: true }); });

test('this repository satisfies its native OpenCode contract', () => {
  assert.deepEqual(checkContract(root), []);
});

test('the discoverable OpenCode skill has a routing description', () => {
  const frontmatter = readFrontmatter(readFileSync(join(root, 'opencode/SKILL.md'), 'utf8'));
  assert.equal(readField(frontmatter, 'name').value, 'opencode-computer-use');
  assert.ok(readField(frontmatter, 'description').value.length > 80);
});

test('the package fixture passes before testing invalid changes', () => {
  assert.deepEqual(checkContract(packageFixture()), []);
});

test('a missing skill description is reported', () => {
  const folder = packageFixture();
  const skill = join(folder, 'opencode/SKILL.md');
  writeFileSync(skill, readFileSync(skill, 'utf8').replace(/description:[\s\S]*?\n---/, '---'));
  assert.match(checkContract(folder).join('\n'), /no description/);
});

test('an unquoted colon in skill metadata is rejected', () => {
  const folder = packageFixture();
  const skill = join(folder, 'opencode/SKILL.md');
  writeFileSync(skill, readFileSync(skill, 'utf8').replace(/description:[\s\S]*?\n---/, 'description: a colon: breaks YAML\n---'));
  assert.match(checkContract(folder).join('\n'), /plain YAML scalar/);
});

test('an undocumented command is reported', () => {
  const folder = packageFixture();
  const readme = join(folder, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/opencode-cu shot/g, 'opencode-cu snap'));
  const problems = checkContract(folder).join('\n');
  assert.match(problems, /documents "opencode-cu snap", which does not exist/);
  assert.match(problems, /never mentions "opencode-cu shot"/);
});

test('incorrect package entry, CLI or host requirements fail the contract', () => {
  const folder = packageFixture();
  const path = join(folder, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.main = 'wrong.js';
  manifest.bin = {};
  manifest.engines.other = '*';
  writeFileSync(path, JSON.stringify(manifest));
  const problems = checkContract(folder).join('\n');
  assert.match(problems, /native entry/);
  assert.match(problems, /expose src\/cli.js as opencode-cu/);
  assert.match(problems, /only Node.js/);
});

test('a missing MCP entry or mismatched skill name fails the contract', () => {
  const folder = packageFixture();
  rmSync(join(folder, 'opencode/mcp.js'));
  writeFileSync(join(folder, 'opencode/SKILL.md'), '---\nname: wrong-name\ndescription: test\n---\n');
  const problems = checkContract(folder).join('\n');
  assert.match(problems, /missing opencode\/mcp.js/);
  assert.match(problems, /must declare name: opencode-computer-use/);
});
