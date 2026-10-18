import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkContract } from '../src/contract.js';
import { SKILL_DESCRIPTION, SKILL_NAME } from '../lib/skill.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = [];

function packageFixture() {
  const folder = mkdtempSync(join(tmpdir(), 'dsh-cu-contract-'));
  fixtures.push(folder);
  for (const file of ['SKILL.md', 'README.md', 'package.json', 'cordis.patch.yml', 'install-opencode.ps1']) {
    copyFileSync(join(root, file), join(folder, file));
  }
  mkdirSync(join(folder, 'lib'), { recursive: true });
  mkdirSync(join(folder, 'src'), { recursive: true });
  writeFileSync(join(folder, 'lib', 'index.js'), '');
  writeFileSync(join(folder, 'src', 'cli.js'), '');
  writeFileSync(join(folder, 'src', 'opencode.js'), '');
  writeFileSync(join(folder, 'src', 'install-opencode.js'), '');
  mkdirSync(join(folder, 'opencode'));
  for (const file of ['plugin.js', 'mcp.js', 'SKILL.md', 'INSTRUCTIONS.md'])
    copyFileSync(join(root, 'opencode', file), join(folder, 'opencode', file));
  return folder;
}

after(() => {
  for (const folder of fixtures) rmSync(folder, { recursive: true, force: true });
});

test('this repository satisfies its own contract', () => {
  assert.deepEqual(checkContract(root), []);
});

test('the skill is registered under the package name', () => {
  assert.equal(SKILL_NAME, 'dsh-computer-use');
  assert.ok(SKILL_DESCRIPTION.length > 80, 'a one-line description must be long enough to route on');
});

test('the package fixture passes, so the negative cases below mean something', () => {
  assert.deepEqual(checkContract(packageFixture()), []);
});

test('a skill that no longer declares a description is reported', () => {
  const folder = packageFixture();
  writeFileSync(join(folder, 'SKILL.md'), readFileSync(join(root, 'SKILL.md'), 'utf8').replace(/description:[\s\S]*?\n---/, '---'));
  assert.match(checkContract(folder).join('\n'), /SKILL\.md must start with YAML frontmatter|has no `description`/);
});

test('a plain description containing ": " is rejected with the reason', () => {
  const folder = packageFixture();
  const broken = readFileSync(join(root, 'SKILL.md'), 'utf8').replace(/description:[\s\S]*?\n---/, 'description: a colon: breaks YAML\n---');
  writeFileSync(join(folder, 'SKILL.md'), broken);
  assert.match(checkContract(folder).join('\n'), /plain YAML scalar containing ": "/);
});

test('an undocumented command is reported', () => {
  const folder = packageFixture();
  const readme = readFileSync(join(folder, 'README.md'), 'utf8').replace(/dsh-cu shot/g, 'dsh-cu snap');
  writeFileSync(join(folder, 'README.md'), readme);
  const problems = checkContract(folder).join('\n');
  assert.match(problems, /documents "dsh-cu snap", which does not exist/);
  assert.match(problems, /never mentions "dsh-cu shot"/);
});

test('a bundle without a patch file is reported', () => {
  const folder = packageFixture();
  rmSync(join(folder, 'cordis.patch.yml'));
  assert.match(checkContract(folder).join('\n'), /dsh\.bundle\.patch points at .* which does not exist/);
});

test('a missing OpenCode entry or mismatched skill name fails the static contract', () => {
  const folder = packageFixture();
  rmSync(join(folder, 'opencode', 'mcp.js'));
  writeFileSync(join(folder, 'opencode', 'SKILL.md'), '---\nname: wrong-name\ndescription: test\n---\n');
  assert.match(checkContract(folder).join('\n'), /missing opencode\/mcp.js/);
  assert.match(checkContract(folder).join('\n'), /must declare name: opencode-computer-use/);
});
