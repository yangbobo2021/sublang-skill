#!/usr/bin/env node
// Refresh the standalone Skill's version and integrity manifest after edits.
// This does not publish, install dependencies or replace the Git checkout.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const {values} = parseArgs({options: {version: {type: 'string'}}});
const manifest = join(root, 'runtime/release.json');
if (!existsSync(manifest)) throw new Error('Run the SPEX standalone builder before refreshing a source-only Skill.');
const release = JSON.parse(readFileSync(manifest, 'utf8'));
if (values.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(values.version)) throw new Error('--version must be a semantic version.');
if (values.version) {
  release.version = values.version;
  for (const file of ['package.json', 'package-lock.json']) {
    const path = join(root, 'runtime', file);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.version = values.version;
    if (data.packages?.['']) data.packages[''].version = values.version;
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  }
}
const files = {};
const record = file => { files[relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(file)).digest('hex'); };
const visit = dir => {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === '.DS_Store' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const file = join(dir, entry.name);
    if (file === manifest) continue;
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile()) record(file);
    else throw new Error(`Non-regular Skill distribution file: ${file}`);
  }
};
for (const name of ['SKILL.md', 'LICENSE']) if (existsSync(join(root, name))) record(join(root, name));
for (const name of ['agents', 'references', 'scripts', 'runtime']) visit(join(root, name));
release.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
release.builtAt = new Date().toISOString();
writeFileSync(manifest, JSON.stringify(release, null, 2) + '\n');
process.stdout.write(JSON.stringify({ok: true, version: release.version, files: Object.keys(files).length}) + '\n');
