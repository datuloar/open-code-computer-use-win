import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS } from './commands.js';
import { readField, readFrontmatter } from './frontmatter.js';
import { SKILL_NAME } from './opencode.js';
import OpenCodeComputerUse from '../opencode/plugin.js';

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PUBLISHED = ['src', 'backends', 'bin', 'opencode', 'install-opencode.ps1'];
const REQUIRED = ['opencode/plugin.js', 'opencode/mcp.js', 'opencode/SKILL.md', 'opencode/INSTRUCTIONS.md',
  'src/cli.js', 'src/opencode.js', 'src/install-opencode.js', 'backends/windows.ps1', 'bin/opencode-cu.cmd', 'install-opencode.ps1'];

export function documentedCommands(text) {
  return new Set([...text.matchAll(/opencode-cu\s+([a-z][a-z-]*)/g)].map((match) => match[1]));
}

export function checkContract(root) {
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const manifest = JSON.parse(read('package.json'));
  const problems = [];
  for (const file of REQUIRED) if (!existsSync(join(root, file))) problems.push(`OpenCode integration is missing ${file}`);
  if (manifest.name !== 'opencode-computer-use') problems.push('package.json name must be opencode-computer-use');
  if (manifest.main !== 'opencode/plugin.js') problems.push('package.json main must be the native entry opencode/plugin.js');
  if (manifest.exports?.['.'] !== './opencode/plugin.js') problems.push('package.json must export the native OpenCode plugin at its root');
  if (manifest.exports?.['./mcp'] !== './opencode/mcp.js') problems.push('package.json must export ./mcp as ./opencode/mcp.js');
  if (manifest.bin?.['opencode-cu'] !== 'src/cli.js') problems.push('package.json bin must expose src/cli.js as opencode-cu');
  for (const entry of PUBLISHED) if (!manifest.files?.includes(entry)) problems.push(`package.json files[] must include ${entry}`);
  if (!manifest.engines?.node || Object.keys(manifest.engines).some((key) => key !== 'node'))
    problems.push('package.json engines must declare only Node.js');
  if (Object.keys(manifest.dependencies || {}).length || Object.keys(manifest.peerDependencies || {}).length)
    problems.push('the OpenCode distribution must not require runtime or peer dependencies');
  if (typeof OpenCodeComputerUse !== 'function') problems.push('the native OpenCode entry must export a plugin function');
  const skill = 'opencode/SKILL.md';
  if (existsSync(join(root, skill))) {
    const frontmatter = readFrontmatter(read(skill));
    if (!frontmatter) problems.push('OpenCode skill has no YAML frontmatter block');
    const name = frontmatter && readField(frontmatter, 'name');
    const description = frontmatter && readField(frontmatter, 'description');
    if (name?.value !== SKILL_NAME) problems.push(`OpenCode skill must declare name: ${SKILL_NAME}`);
    if (!description?.value) problems.push('OpenCode skill frontmatter has no description');
    else if (description.style === 'plain' && description.value.includes(': '))
      problems.push('OpenCode skill description is a plain YAML scalar containing ": "');
  }
  const names = new Set();
  for (const command of COMMANDS) {
    if (names.has(command.name)) problems.push(`two commands are named "${command.name}"`);
    names.add(command.name);
    if (!NAME_PATTERN.test(command.name) || typeof command.run !== 'function' || !command.summary)
      problems.push(`command "${command.name}" needs a valid name, handler and summary`);
  }
  const documented = documentedCommands(read('README.md'));
  for (const command of documented) if (!names.has(command)) problems.push(`README.md documents "opencode-cu ${command}", which does not exist`);
  for (const command of names) if (!documented.has(command)) problems.push(`README.md never mentions "opencode-cu ${command}"`);
  return problems;
}
