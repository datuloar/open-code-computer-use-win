#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContract } from './contract.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = checkContract(root);

if (problems.length === 0) {
  console.log('verify: skill frontmatter, command surface and plugin manifest agree');
  process.exit(0);
}

console.error(`verify: ${problems.length} problem(s)`);
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
