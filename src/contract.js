import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS } from './commands.js';
import { readField, readFrontmatter } from '../lib/frontmatter.js';
import { SKILL, SKILL_DESCRIPTION, SKILL_NAME } from '../lib/skill.js';
import { apply, inject, name as pluginName } from '../lib/index.js';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOCUMENTS = ['SKILL.md', 'README.md'];
const PUBLISHED = ['lib', 'src', 'backends', 'opencode', 'install-opencode.ps1', 'SKILL.md', 'cordis.patch.yml'];

export function documentedCommands(text) {
  return new Set([...text.matchAll(/dsh-cu\s+([a-z][a-z-]*)/g)].map((match) => match[1]));
}

function checkSkillFile(read) {
  const problems = [];
  const frontmatter = readFrontmatter(read('SKILL.md'));
  if (frontmatter === null) return ['SKILL.md has no YAML frontmatter block, so no host will discover it'];

  const name = readField(frontmatter, 'name');
  const description = readField(frontmatter, 'description');
  if (!name) problems.push('SKILL.md frontmatter has no `name`');
  else if (!SKILL_NAME_PATTERN.test(name.value)) problems.push(`SKILL.md name "${name.value}" is not kebab-case`);
  if (!description?.value) {
    problems.push('SKILL.md frontmatter has no `description`');
  } else if (description.style === 'plain' && description.value.includes(': ')) {
    problems.push(
      'SKILL.md description is a plain YAML scalar containing ": " - quote it or use a block scalar, ' +
        'otherwise every YAML parser rejects the file and the skill disappears from the catalog',
    );
  }
  if (name && name.value !== SKILL_NAME) {
    problems.push(`SKILL.md name "${name.value}" and lib/skill.js SKILL_NAME "${SKILL_NAME}" disagree`);
  }
  if (description?.value && description.value !== SKILL_DESCRIPTION) {
    problems.push('SKILL.md description and the description lib/skill.js registers disagree');
  }
  return problems;
}

function checkDocumentedCommands(read) {
  const problems = [];
  const names = COMMANDS.map((command) => command.name);
  for (const file of DOCUMENTS) {
    const documented = documentedCommands(read(file));
    for (const command of documented) {
      if (!names.includes(command)) problems.push(`${file} documents "dsh-cu ${command}", which does not exist`);
    }
    for (const command of names) {
      if (!documented.has(command)) problems.push(`${file} never mentions "dsh-cu ${command}"`);
    }
  }
  return problems;
}

function checkCommandTable() {
  const problems = [];
  const seen = new Set();
  for (const command of COMMANDS) {
    if (seen.has(command.name)) problems.push(`two commands are named "${command.name}"`);
    seen.add(command.name);
    if (!SKILL_NAME_PATTERN.test(command.name)) problems.push(`command name "${command.name}" is not kebab-case`);
    if (typeof command.run !== 'function') problems.push(`command "${command.name}" has no handler`);
    if (!command.summary) problems.push(`command "${command.name}" has no summary for --help`);
  }
  return problems;
}

function checkManifest(root, manifest, read) {
  const problems = [];
  const patch = manifest.dsh?.bundle?.patch;
  if (!patch) {
    problems.push('package.json declares no dsh.bundle.patch, so the plugin market cannot layer it into a profile');
  } else if (!existsSync(join(root, patch))) {
    problems.push(`package.json dsh.bundle.patch points at ${patch}, which does not exist`);
  } else if (!read(patch).includes(manifest.name)) {
    problems.push(`${patch} does not mount "${manifest.name}"`);
  }
  if (manifest.main !== 'lib/index.js') problems.push('package.json main must be the plugin entry lib/index.js');
  if (manifest.bin?.['dsh-cu'] !== 'src/cli.js') problems.push('package.json bin must expose src/cli.js as dsh-cu');
  for (const entry of PUBLISHED) {
    if (!manifest.files?.includes(entry)) problems.push(`package.json files[] must publish ${entry}`);
  }
  for (const relative of [manifest.bin?.['dsh-cu'], 'SKILL.md', 'cordis.patch.yml', 'lib/index.js']) {
    if (relative && !existsSync(join(root, relative))) problems.push(`${relative} is missing`);
  }
  return problems;
}

function checkPluginMount(manifest) {
  const problems = [];
  if (SKILL.name !== SKILL_NAME) problems.push('lib/skill.js registers a name that is not SKILL_NAME');
  if (!SKILL.content.includes('# dsh-computer-use')) problems.push('lib/skill.js registers a body that is not SKILL.md');
  if (SKILL.resourceBase?.kind !== 'directory' || !existsSync(SKILL.resourceBase.path)) {
    problems.push('lib/skill.js registers a resource base that does not exist');
  }
  if (pluginName !== manifest.name) problems.push(`lib/index.js plugin name "${pluginName}" is not the package name`);
  if (!Array.isArray(inject) || !inject.includes('skills')) {
    problems.push('lib/index.js must inject the skills registry');
  }

  let registered = null;
  const disposers = [];
  apply({
    skills: {
      register(skill) {
        registered = skill;
        return () => {
          registered = null;
        };
      },
    },
    effect(body) {
      disposers.push(body());
    },
  });
  if (!registered) problems.push('lib/index.js apply() did not register a skill');
  else if (registered.name !== SKILL_NAME) problems.push('lib/index.js registered a skill under another name');
  if (typeof disposers[0] !== 'function') problems.push('lib/index.js must register the skill through ctx.effect');
  return problems;
}

function checkOpenCode(root, manifest, read) {
  const problems = [];
  for (const file of ['opencode/plugin.js', 'opencode/mcp.js', 'opencode/SKILL.md', 'opencode/INSTRUCTIONS.md',
    'src/opencode.js', 'src/install-opencode.js', 'install-opencode.ps1']) {
    if (!existsSync(join(root, file))) problems.push(`OpenCode integration is missing ${file}`);
  }
  if (manifest.exports?.['./opencode'] !== './opencode/plugin.js')
    problems.push('package.json must export ./opencode as ./opencode/plugin.js');
  if (existsSync(join(root, 'opencode/SKILL.md'))) {
    const frontmatter = readFrontmatter(read('opencode/SKILL.md'));
    if (!frontmatter || readField(frontmatter, 'name')?.value !== 'opencode-computer-use')
      problems.push('OpenCode skill must declare name: opencode-computer-use');
    if (!frontmatter || !readField(frontmatter, 'description')?.value)
      problems.push('OpenCode skill needs a description for automatic discovery');
  }
  return problems;
}

export function checkContract(root) {
  const read = (name) => readFileSync(join(root, name), 'utf8');
  const manifest = JSON.parse(read('package.json'));
  return [
    ...checkSkillFile(read),
    ...checkCommandTable(),
    ...checkDocumentedCommands(read),
    ...checkManifest(root, manifest, read),
    ...checkPluginMount(manifest),
    ...checkOpenCode(root, manifest, read),
  ];
}
