import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from './commands.js';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const directories = ['src', 'lib', 'backends', 'bin', 'test', 'packaging'];
const rootFiles = ['SKILL.md', 'LICENSE', 'cordis.patch.yml', 'install.ps1', 'install-opencode.ps1', 'install-vision.ps1', 'package-opencode.ps1'];
const adapterFiles = ['plugin.js', 'mcp.js', 'SKILL.md', 'INSTRUCTIONS.md', 'DESIGN.md'];
const documents = {
  'README.opencode.md': 'README.md',
  'AGENTS.opencode.md': 'AGENTS.md',
  'INSTALL.opencode.md': 'docs/INSTALL.md',
  'AGENT_SETUP.opencode.md': 'docs/AGENT_SETUP.md',
  'SAFETY.opencode.md': 'docs/SAFETY.md',
  'PUBLISHING.opencode.md': 'docs/PUBLISHING.md',
  'VALIDATION.opencode.md': 'docs/VALIDATION.md',
  'adapter-README.opencode.md': 'opencode/README.md',
  'ci.opencode.yml': '.github/workflows/ci.yml',
  'release.opencode.yml': '.github/workflows/release.yml',
};
const manifestName = 'PACKAGE-MANIFEST.json';
const checksum = (data) => createHash('sha256').update(data).digest('hex');

function inside(base, path) {
  const rest = relative(base, path);
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
}

function sourceFile(root, path) {
  const file = join(root, path);
  if (!inside(root, file)) throw new Error(`package source escapes its root: ${path}`);
  let current = root;
  for (const part of relative(root, file).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`symlinks cannot be packaged: ${path}`);
  }
  if (!lstatSync(file).isFile())
    throw new Error(`package source must be a regular file: ${path}`);
  return readFileSync(file);
}

function walk(root, path, accept, visit) {
  const directory = join(root, path);
  if (lstatSync(directory).isSymbolicLink()) throw new Error(`symlinks cannot be packaged: ${path}`);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const next = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`symlinks cannot be packaged: ${next}`);
    if (entry.isDirectory()) {
      if (!accept(next, true)) continue;
      walk(root, next, accept, visit);
    } else if (entry.isFile() && accept(next, false)) visit(next);
  }
}

export function buildOpenCodePackage({ root = sourceRoot, outputDir, repository = 'datuloar/open-code-computer-use-win' } = {}) {
  root = resolve(root);
  if (repository !== undefined && (typeof repository !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/i.test(repository)
    || repository.split('/')[1] === '.' || repository.split('/')[1] === '..'))
    throw new Error('repository must be a GitHub owner/repository slug');
  const manifest = JSON.parse(sourceFile(root, 'package.json').toString('utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(manifest.version)) throw new Error('package version must be a safe semantic version');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = resolve(outputDir || join(root, 'dist', `opencode-${manifest.version}-${stamp}`));
  if (inside(output, root) || directories.some((path) => inside(join(root, path), output)) || inside(join(root, 'opencode'), output))
    throw new Error('output must not replace the source or sit inside a source directory');
  if (existsSync(output)) throw new Error('output directory already exists; choose a new path');
  const files = new Map();
  const add = (target, data) => files.set(target, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  for (const directory of directories) {
    const pattern = directory === 'src' || directory === 'lib' ? /\.js$/
      : directory === 'backends' ? /\.(?:ps1|cs)$/ : directory === 'bin' ? /\.cmd$/
        : directory === 'test' ? /\.(?:js|mjs|ps1)$/ : /\.(?:md|yml)$/;
    walk(root, directory, (path, isDirectory) => isDirectory ? !/(?:^|\/)(?:node_modules|dist|\.git)$/.test(path) : pattern.test(path),
      (path) => add(path, sourceFile(root, path).toString('utf8').replaceAll('\r\n', '\n')));
  }
  for (const path of rootFiles) add(path, sourceFile(root, path).toString('utf8').replaceAll('\r\n', '\n'));
  for (const file of adapterFiles) {
    const path = `opencode/${file}`;
    add(path, sourceFile(root, path).toString('utf8').replaceAll('\r\n', '\n'));
  }
  add('docs/opencode-indicator.png', sourceFile(root, 'docs/opencode-indicator.png'));
  const alternatives = 'docs/opencode-alternatives-2026-10-18.md';
  add(alternatives, sourceFile(root, alternatives).toString('utf8').replaceAll('\r\n', '\n'));
  for (const [source, target] of Object.entries(documents)) {
    let body = sourceFile(root, `packaging/${source}`).toString('utf8').replaceAll('\r\n', '\n');
    if (target === 'README.md') {
      const commands = COMMANDS.map((command) => `dsh-cu ${command.name}${command.args ? ` ${command.args}` : ''}`).join('\n');
      body = body.replace('{{CLI_REFERENCE}}', `\`\`\`text\n${commands}\n\`\`\``);
    }
    add(target, body);
  }
  manifest.private = true;
  manifest.description = 'Windows desktop tools for OpenCode: UI Automation, OCR, screenshots and gated mouse/keyboard input with a visible ESC indicator.';
  manifest.keywords = [...new Set([...(manifest.keywords || []), 'opencode', 'mcp'])];
  manifest.files = [...new Set(manifest.files.filter((path) => path !== 'test/desktop-fixture.ps1').concat('test', 'packaging', 'package-opencode.ps1', 'AGENTS.md'))];
  if (repository) {
    manifest.repository = { type: 'git', url: `git+https://github.com/${repository}.git` };
    manifest.homepage = `https://github.com/${repository}#readme`;
    manifest.bugs = { url: `https://github.com/${repository}/issues` };
  } else {
    delete manifest.repository;
    delete manifest.homepage;
    delete manifest.bugs;
  }
  add('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
  add('.gitattributes', '* text=auto eol=lf\n*.png binary\n*.zip binary\n');
  add('.gitignore', 'node_modules/\ndist/\n.env\n.env.*\n!.env.example\nopencode.json\nopencode.jsonc\n.opencode/\nbackups/\n*.log\n*.shot.png\n.shot.png\nshots/\n.playwright-mcp/\n');
  for (const [path, data] of files) {
    if (path.endsWith('.md') && /[\u0400-\u04ff]/u.test(data.toString('utf8')))
      throw new Error(`package documentation must be English: ${path}`);
  }
  const inventory = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, data]) => ({ path, bytes: data.length, sha256: checksum(data) }));
  const directory = join(output, 'opencode-computer-use');
  mkdirSync(directory, { recursive: true });
  for (const [path, data] of files) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  writeFileSync(join(directory, manifestName), `${JSON.stringify({ schemaVersion: 1, name: 'opencode-computer-use', version: manifest.version,
    generatedAt: new Date().toISOString(), ...(repository ? { repository } : {}), files: inventory }, null, 2)}\n`);
  return { directory, version: manifest.version, files: inventory.length, manifest: join(directory, manifestName) };
}

export function verifyOpenCodePackage(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(sourceFile(root, manifestName).toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.name !== 'opencode-computer-use' || !Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error('unsupported OpenCode package manifest');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !entry.path || entry.path.split('/').some((part) => !part || part === '.' || part === '..')
      || /[\\:\0]/.test(entry.path) || isAbsolute(entry.path) || seen.has(entry.path)) throw new Error('invalid package manifest path');
    seen.add(entry.path);
    const data = sourceFile(root, entry.path);
    if (entry.bytes !== data.length || entry.sha256 !== checksum(data)) throw new Error(`package integrity mismatch: ${entry.path}`);
  }
  walk(root, '', (path, isDirectory) => isDirectory ? !['.git', 'dist', 'node_modules'].includes(path) : true,
    (path) => { if (path !== manifestName && !seen.has(path)) throw new Error(`unexpected file in package: ${path}`); });
  return { directory: root, version: manifest.version, files: seen.size, valid: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = {};
    let check;
    for (let index = 2; index < process.argv.length; index++) {
      const flag = process.argv[index];
      if (!['--output-dir', '--repository', '--check'].includes(flag)) throw new Error(`unknown packaging argument: ${flag}`);
      const value = process.argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (flag === '--check') check = value;
      else options[flag === '--output-dir' ? 'outputDir' : 'repository'] = value;
    }
    if (check && Object.keys(options).length) throw new Error('--check cannot be combined with export arguments');
    console.log(JSON.stringify(check ? verifyOpenCodePackage(check) : buildOpenCodePackage(options), null, 2));
  } catch (error) {
    console.error(`OpenCode package: ${error.message}`);
    process.exitCode = 1;
  }
}
