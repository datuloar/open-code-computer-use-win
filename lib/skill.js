import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readField, readFrontmatter } from './frontmatter.js';

export const SKILL_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const SKILL_CONTENT = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');

const frontmatter = readFrontmatter(SKILL_CONTENT);
const name = frontmatter && readField(frontmatter, 'name');
const description = frontmatter && readField(frontmatter, 'description');

if (!name?.value || !description?.value) {
  throw new Error('SKILL.md must start with YAML frontmatter declaring `name` and `description`');
}

export const SKILL_NAME = name.value;

export const SKILL_DESCRIPTION = description.value;

export const SKILL = {
  name: SKILL_NAME,
  description: SKILL_DESCRIPTION,
  source: 'runtime',
  resourceBase: { kind: 'directory', path: SKILL_ROOT },
  content: SKILL_CONTENT,
};
