#!/usr/bin/env node
// Release-only builder. Both tarballs and built-ins come from this one
// source tree; installing the Skill never builds or maintains Core source.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { npmInvocation } from './platform.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = join(root, 'runtime');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const source = json(join(runtime, 'source.json'));
const {values} = parseArgs({options: {repository: {type:'string'}}});
if (!values.repository) throw new Error('--repository must name a local SPEX Git repository containing the pinned upstream commit');
const repository = resolve(values.repository);
const temporary = mkdtempSync(join(tmpdir(), 'sublang unified build '));
const tree = join(temporary, 'source');
const git = (args, cwd=tree) => execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:20*1024*1024}).trim();
const npm = (args, cwd=tree) => {
  const call = npmInvocation(args);
  return execFileSync(call.command,call.args,{cwd,env:{...process.env,ELECTRON_SKIP_BINARY_DOWNLOAD:'1'},encoding:'utf8',maxBuffer:30*1024*1024,stdio:['ignore','pipe','inherit']});
};
let added = false;
try {
  git(['worktree','add','--detach',tree,source.commit],repository); added = true;
  git(['apply','--index',join(runtime,source.patch)]);
  const provenance = {...source, patchSha256:sha(join(runtime,source.patch)), tree:git(['write-tree']), lockSha256:sha(join(tree,'package-lock.json'))};
  // Clean dependency installation is intentional: a symlink to another
  // checkout's node_modules would make the staged content untrustworthy.
  process.stderr.write('Installing pinned source dependencies…\n');
  npm(['ci','--no-audit','--no-fund']);
  process.stderr.write('Rebuilding CLI, Core and built-in content…\n');
  npm(['run','build','-w','@sublang/spex-core']);
  if (git(['diff','--name-only'])) throw new Error('Build changed tracked source or lock inputs');
  const sourceLock = json(join(tree,'package-lock.json'));
  const dependencies = json(join(runtime,'package.json')).dependencies;
  for (const [name,version] of Object.entries(dependencies)) {
    if (!version.startsWith('file:') && sourceLock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`Source/runtime lock mismatch for ${name}`);
  }
  const playbook = json(join(tree,'node_modules/@sublang/playbook/package.json')).version;
  const builtin = join(tree,'packages/core/assets/builtins',playbook,'meta.yaml');
  if (!readFileSync(builtin,'utf8').includes(`version: ${playbook}`)) throw new Error('Built-in content does not match the installed engine');
  // Both archives carry the same build record, so diagnostics can identify
  // the serving Core independently of the caller's cache.
  const build = {...provenance, playbook, builtinPackage:{name:'sublang/playbooks',version:playbook}};
  writeFileSync(join(tree,'packages/core/assets/skill-runtime.json'),JSON.stringify(build,null,2)+'\n');
  writeFileSync(join(tree,'packages/cli/dist/skill-runtime.js'),'export default '+JSON.stringify(build,null,2)+';\n');
  const staged = [];
  for (const [workspace,name] of [['cli','spex-cli.tgz'],['core','spex-core.tgz']]) {
    const packed = JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',temporary],join(tree,'packages',workspace)))[0];
    staged.push([join(temporary,packed.filename),join(runtime,'vendor',name)]);
  }
  // Replace together only after both builds and packs succeeded.
  for (const [from,to] of staged) renameSync(from,to);
  const release = json(join(runtime,'release.json'));
  const protocol = readFileSync(join(tree,'packages/core/dist/protocol.js'),'utf8').match(/PROTOCOL_VERSION = (\d+)/);
  if (!protocol) throw new Error('Built Core has no protocol version');
  Object.assign(release,{sourceCommit:source.commit,sourceDirty:false,source:provenance,protocolVersion:Number(protocol[1]),builtinPackage:build.builtinPackage});
  release.artifactSources = Object.fromEntries(['spex-cli.tgz','spex-core.tgz'].map(name=>[`runtime/vendor/${name}`,provenance]));
  writeFileSync(join(runtime,'release.json'),JSON.stringify(release,null,2)+'\n');
  // npm otherwise may reuse the old file: archive's cached lock metadata.
  const lockFile=join(runtime,'package-lock.json'), lock=json(lockFile);
  for (const name of ['@sublang/spex','@sublang/spex-core']) delete lock.packages[`node_modules/${name}`];
  writeFileSync(lockFile,JSON.stringify(lock,null,2)+'\n');
  npm(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],runtime);
  process.stdout.write(JSON.stringify({ok:true,source:provenance,playbook,protocolVersion:release.protocolVersion})+'\n');
} finally {
  if (added) git(['worktree','remove','--force',tree],repository);
  rmSync(temporary,{recursive:true,force:true});
}
