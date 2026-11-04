import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname,'..');
const json = file => JSON.parse(readFileSync(file,'utf8'));
test('one recorded source tree owns both archives and the matching built-in seed', () => {
  const release = json(join(root,'runtime/release.json'));
  const patch = readFileSync(join(root,'runtime',release.source.patch));
  assert.equal(createHash('sha256').update(patch).digest('hex'),release.source.patchSha256);
  assert.equal(release.sourceDirty,false);
  assert.equal(release.source.commit,json(join(root,'runtime/source.json')).commit);
  assert.equal(release.builtinPackage.version,release.dependencies['@sublang/playbook']);
  for (const artifact of ['spex-cli','spex-core']) assert.deepEqual(release.artifactSources[`runtime/vendor/${artifact}.tgz`],release.source);
});

test('installed CLI and Core carry identical provenance and resolve one engine from their own locations', {skip:!process.env.SUBLANG_TEST_RUNTIME}, async () => {
  const runtime = resolve(process.env.SUBLANG_TEST_RUNTIME);
  const release = json(join(runtime,'release.json'));
  const require = createRequire(join(runtime,'package.json'));
  const core = dirname(dirname(require.resolve('@sublang/spex-core')));
  const cli = dirname(require.resolve('@sublang/spex/package.json'));
  const coreBuild = json(join(core,'assets/skill-runtime.json'));
  const cliBuild = (await import(pathToFileURL(join(cli,'dist/skill-runtime.js')))).default;
  assert.deepEqual(coreBuild,cliBuild);
  for (const key of ['commit','tree','lockSha256','patchSha256']) assert.equal(coreBuild[key],release.source[key]);
  const target = realpathSync(require.resolve('@sublang/playbook/xstate-runtime'));
  for (const file of [join(core,'dist/index.js'),join(runtime,'node_modules/@sublang/slc/package.json')]) {
    const relativeRequire = createRequire(file);
    assert.equal(realpathSync(relativeRequire.resolve('@sublang/playbook/xstate-runtime')),target);
  }
  const versions = json(join(core,'assets/skill-runtime.json'));
  assert.equal(versions.builtinPackage.version,release.dependencies['@sublang/playbook']);
});
