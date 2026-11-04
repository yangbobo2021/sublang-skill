import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { isAbsolute, posix, win32 } from 'node:path';

// Optional platform arguments let non-Windows hosts exercise Windows path
// semantics without pretending to run a Windows process or filesystem.
export const pathApi = platform => platform === 'win32' ? win32 : posix;

export function absolutePath(value, platform = process.platform) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  if (platform === 'win32') return /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/\/[^/]+\/[^/]+)/i.test(value) && win32.isAbsolute(value);
  return isAbsolute(value);
}

export function containedFile(root, file, platform = process.platform) {
  const path = pathApi(platform);
  const fromRoot = path.relative(root, file);
  return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(fromRoot);
}

export function prependPath(env, directory, platform = process.platform) {
  const result = {...env};
  const keys = Object.keys(result).filter(key => platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');
  const key = keys.find(name => name === 'PATH') || keys[0] || 'PATH';
  const previous = result[key] || '';
  for (const name of keys) delete result[name];
  result[key] = directory + (previous ? pathApi(platform).delimiter + previous : '');
  return result;
}

// Invoke npm's JavaScript entry with Node, avoiding .cmd execution and shell
// quoting entirely (including installations in folders containing spaces).
export function npmInvocation(args, {env = process.env, execPath = process.execPath, platform = process.platform, exists = existsSync} = {}) {
  const path = pathApi(platform);
  const nodeDir = path.dirname(execPath);
  const pathKey = Object.keys(env).find(key => platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');
  const candidates = [
    ...(env.npm_execpath && /(?:^|[\\/])npm-cli\.js$/i.test(env.npm_execpath) ? [env.npm_execpath] : []),
    path.join(nodeDir, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(env[pathKey] || '').split(path.delimiter).filter(Boolean).flatMap(dir => [
      path.join(dir, 'node_modules/npm/bin/npm-cli.js'),
      path.resolve(dir, '../lib/node_modules/npm/bin/npm-cli.js'),
    ]),
  ];
  const cli = candidates.find(file => exists(file));
  if (cli) return {command: execPath, args: [cli, ...args]};
  if (platform !== 'win32') return {command: 'npm', args};
  throw new Error('npm-cli.js was not found; run scripts/setup.ps1 to prepare the bundled Node/npm runtime.');
}

export function linkDirectory(target, link, platform = process.platform) {
  symlinkSync(target, link, platform === 'win32' ? 'junction' : 'dir');
}

export function sameDirectory(a, b) {
  try {
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    return normalize(realpathSync(a)) === normalize(realpathSync(b));
  } catch { return false; }
}
