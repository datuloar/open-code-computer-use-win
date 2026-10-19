import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { root } from './backend.js';
import { configureOpenCode, pluginUrl, SERVER_NAME, SKILL_NAME } from './opencode.js';

export function parseConfig(source) {
  const chars = [...source.replace(/^\uFEFF/, '')];
  let quoted = false;
  let escaped = false;
  let comment = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (comment === 'line') {
      if (c === '\n' || c === '\r') comment = '';
      else chars[i] = ' ';
    } else if (comment === 'block') {
      chars[i] = c === '\n' ? '\n' : ' ';
      if (c === '*' && next === '/') { chars[++i] = ' '; comment = ''; }
    } else if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '/' && (next === '/' || next === '*')) {
      comment = next === '/' ? 'line' : 'block';
      chars[i] = chars[++i] = ' ';
    }
  }
  if (comment === 'block') throw new Error('OpenCode config has an unterminated comment');
  quoted = false;
  escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      let next = i + 1;
      while (next < chars.length && /\s/.test(chars[next])) next++;
      if (chars[next] === ']' || chars[next] === '}') chars[i] = ' ';
    }
  }
  const config = JSON.parse(chars.join(''));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('OpenCode config must be an object');
  return config;
}

function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const staged = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(staged, content, 'utf8'); renameSync(staged, file); }
  finally { if (existsSync(staged)) unlinkSync(staged); }
}

export function installOpenCode({ configDir, configPath, node = process.execPath, uninstall = false, model, announceSeconds, write = atomicWrite }) {
  const directory = resolve(configDir || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode'));
  const jsonc = join(directory, 'opencode.jsonc');
  const file = resolve(configPath || process.env.OPENCODE_CONFIG || (existsSync(jsonc) ? jsonc : join(directory, 'opencode.json')));
  const original = existsSync(file) ? readFileSync(file, 'utf8') : '{}';
  const config = parseConfig(original);
  const before = JSON.stringify(config);
  const isOurPlugin = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === pluginUrl;
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error('OpenCode plugin must be an array');
  const skillFile = join(directory, 'skills', SKILL_NAME, 'SKILL.md');
  const skill = readFileSync(join(root, 'opencode', 'SKILL.md'), 'utf8');
  if (uninstall) {
    if (config.plugin) config.plugin = config.plugin.filter((plugin) => !isOurPlugin(plugin));
    if (config.mcp?.[SERVER_NAME]?.command?.[1] === join(root, 'opencode', 'mcp.js')) delete config.mcp[SERVER_NAME];
  } else {
    configureOpenCode(config, { node, announceSeconds });
    if (model !== undefined) {
      if (typeof model !== 'string' || !/^[^\s/]+\/\S+$/.test(model)) throw new Error('model must be provider/model');
      config.model = model;
    }
    config.$schema ||= 'https://opencode.ai/config.json';
    config.plugin = [...(config.plugin || []).filter((plugin) => !isOurPlugin(plugin)), [pluginUrl, { node }]];
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const backups = join(directory, 'backups', 'computer-use', stamp);
  const backup = (path) => {
    mkdirSync(backups, { recursive: true });
    const target = join(backups, path === file ? 'opencode-config' + (file.endsWith('.jsonc') ? '.jsonc' : '.json') : 'SKILL.md');
    copyFileSync(path, target);
  };
  const changes = [];
  if (uninstall) {
    if (existsSync(skillFile) && readFileSync(skillFile, 'utf8') === skill)
      changes.push({ path: skillFile, before: skill, after: null });
  } else if (!existsSync(skillFile) || readFileSync(skillFile, 'utf8') !== skill) {
    changes.push({ path: skillFile, before: existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : null, after: skill });
  }
  if (before !== JSON.stringify(config)) {
    changes.push({ path: file, before: existsSync(file) ? original : null, after: JSON.stringify(config, null, 2) + '\n' });
  }
  for (const change of changes) if (change.before !== null) backup(change.path);
  const applied = [];
  try {
    for (const change of changes) {
      const current = existsSync(change.path) ? readFileSync(change.path, 'utf8') : null;
      if (current !== change.before) throw new Error('OpenCode configuration changed during installation; run the installer again');
      if (change.after === null) unlinkSync(change.path);
      else write(change.path, change.after);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      try {
        const current = existsSync(change.path) ? readFileSync(change.path, 'utf8') : null;
        if (current !== change.after) continue;
        if (change.before === null) unlinkSync(change.path);
        else atomicWrite(change.path, change.before);
      } catch {
        throw new Error(`${error.message}; rollback was incomplete, restore the backup in ${backups}`);
      }
    }
    throw error;
  }
  return { config: file, skill: skillFile, backups: existsSync(backups) ? backups : null, installed: !uninstall };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--uninstall') options.uninstall = true;
      else if (['--config-dir', '--config', '--model', '--announce-seconds'].includes(args[i])) {
        const flag = args[i];
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
        const key = { '--config-dir': 'configDir', '--config': 'configPath', '--model': 'model', '--announce-seconds': 'announceSeconds' }[flag];
        options[key] = value;
      } else throw new Error(`unknown installer argument: ${args[i]}`);
    }
    console.log(JSON.stringify(installOpenCode(options), null, 2));
  } catch (error) {
    console.error(`OpenCode computer use: ${error.message}`);
    process.exitCode = 1;
  }
}
