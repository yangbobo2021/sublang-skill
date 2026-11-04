#!/usr/bin/env node
// Install a built, self-contained distribution; preserve existing user skills.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { linkDirectory, sameDirectory } from './platform.mjs';
const source = dirname(dirname(fileURLToPath(import.meta.url)));
const present = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const samePath = sameDirectory;
try {
  if (!existsSync(join(source, 'runtime', 'release.json'))) throw new Error('Build the standalone distribution before installing.');
  const target = resolve(process.argv[2] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'sublang'));
  if (samePath(source, target)) throw new Error('Source and installation directory are the same.');
  if (existsSync(join(target, '.git'))) throw new Error(`Existing ${target} is a Git checkout and was preserved. Update it with Git rather than replacing or backing up the directory.`);
  const parent = dirname(target);
  mkdirSync(parent, {recursive: true});
  const staged = join(parent, `.sublang-install-${randomUUID()}`);
  cpSync(source, staged, {recursive: true});
  if (present(target)) {
    const manifest = join(target, 'runtime', 'release.json');
    if (lstatSync(target).isSymbolicLink() || !existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).skill !== 'sublang') {
      rmSync(staged, {recursive: true, force: true});
      throw new Error(`Existing ${target} is not an owned SubLang installation; it was preserved.`);
    }
    // Backups must be outside the host's discoverable skills directory.
    const backups = join(parent, '..', 'skill-backups');
    mkdirSync(backups, {recursive: true, mode: 0o700});
    const backup = join(backups, `sublang-${Date.now()}-${randomUUID()}`);
    renameSync(target, backup);
    try { renameSync(staged, target); } catch (error) { renameSync(backup, target); throw error; }
    process.stderr.write(`Previous Skill preserved at ${backup}\n`);
  } else renameSync(staged, target);
  const claude = join(homedir(), '.claude', 'skills', 'sublang');
  mkdirSync(dirname(claude), {recursive: true});
  if (!present(claude)) linkDirectory(target, claude);
  else if (!samePath(claude,target)) process.stderr.write(`Existing Claude Skill preserved at ${claude}; install there explicitly if desired.\n`);
  process.stdout.write(JSON.stringify({ok: true, skill: target, claude: samePath(claude,target) ? claude : null}) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
