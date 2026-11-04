#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { containedFile, npmInvocation, prependPath } from './platform.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const releaseFile = join(root, 'runtime', 'release.json');
  if (!existsSync(releaseFile)) throw new Error('This is a source Skill. Build its standalone distribution with scripts/build-sublang-skill.mjs in the SPEX repository first.');
  const releaseBytes = readFileSync(releaseFile);
  const release = JSON.parse(releaseBytes);
  for (const [path, hash] of Object.entries(release.files)) {
    const full = resolve(root, path);
    if (!containedFile(root, full) || sha(readFileSync(full)) !== hash) throw new Error(`Distribution checksum mismatch: ${path}`);
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 23 || (major === 23 && minor < 6)) throw new Error('Node >=23.6 is required; run scripts/setup.ps1 on Windows or scripts/setup.sh on macOS/Linux.');
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('This Skill release supports macOS, Linux and Windows.');
  const cache = resolve(process.env.SUBLANG_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'sublang-skill'));
  mkdirSync(cache, {recursive: true, mode: 0o700});
  const target = join(cache, `${sha(releaseBytes).slice(0, 20)}-${process.platform}-${process.arch}-${process.versions.modules}`);
  const ready = join(target, '.ready');
  if (!existsSync(ready)) {
    const lock = target + '.installing';
    try { mkdirSync(lock, {mode: 0o700}); }
    catch { throw new Error(`Another setup may be preparing ${target}; inspect ${lock} and retry after it finishes. No lock was removed.`); }
    try {
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({pid: process.pid, at: new Date().toISOString()}));
      mkdirSync(target, {recursive: true, mode: 0o700});
      for (const file of ['package.json', 'package-lock.json']) cpSync(join(root, 'runtime', file), join(target, file));
      cpSync(join(root, 'runtime', 'vendor'), join(target, 'vendor'), {recursive: true});
      cpSync(join(root, 'scripts'), join(target, 'scripts'), {recursive: true});
      cpSync(releaseFile, join(target, 'release.json'));
      const env = prependPath(process.env, dirname(process.execPath));
      const npm = npmInvocation(['ci', '--omit=dev', '--no-audit', '--no-fund'], {env});
      const installed = spawnSync(npm.command, npm.args, {cwd: target, env, stdio: ['ignore', 2, 2]});
      if (installed.error || installed.status !== 0) throw new Error(`Locked dependency preparation failed (${installed.error?.message || installed.status}). Native dependencies may need Python and a C/C++ toolchain. Retry setup after repairing the prerequisite.`);
      writeFileSync(ready, sha(releaseBytes), {mode: 0o600});
    } finally { rmSync(lock, {recursive: true, force: true}); }
  }
  // Keep execution helpers tied to the validated distribution, including on reuse.
  if (readFileSync(ready, 'utf8') !== sha(releaseBytes)) throw new Error('Runtime cache identity mismatch.');
  for (const [path, hash] of Object.entries(release.files)) {
    if (path.startsWith('scripts/')) {
      if (sha(readFileSync(join(target, path))) !== hash) throw new Error(`Runtime helper changed: ${path}; prepare a fresh cache.`);
    }
  }
  process.stdout.write(JSON.stringify({ok: true, node: process.execPath, cli: join(target, 'scripts', 'sublang.mjs'), runtime: target, protocolVersion: release.protocolVersion}) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ok: false, error: {code: 'setup_failed', message: error.message}}) + '\n');
  process.exitCode = 1;
}
