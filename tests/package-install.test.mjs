import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { connect } from '../scripts/client.mjs';

const run = promisify(execFile);
const windows = process.platform === 'win32';
const EVERYONE = 's-1-1-0';
const workflow = 'storage-probe';
const packageName = 'acceptance/storage-probe';
const source = 'Storage fixture: installed, never executed.\n';
const registryModule = `import * as engine from '@sublang/playbook/xstate-runtime';
export const spexRegistryContract = 3;
export default {id:'storage-probe',command:'storage-probe',intent:'Install-only storage regression',artifactSchema:3,requiredRoleIds:[],validateOptions: x => x,createRuntime(){throw new Error('This installation test must never execute a workflow');}};\n`;

function grant(path, rights) {
  execFileSync('icacls.exe', [path, '/grant', `*${EVERYONE}:${rights}`], {windowsHide:true, stdio:'pipe'});
}

test('distributed package-add installs a Playbook under Windows read grants without changing existing ACLs', {skip: !process.env.SUBLANG_TEST_RUNTIME, timeout:180000}, async t => {
  const runtime = resolve(process.env.SUBLANG_TEST_RUNTIME);
  const require = createRequire(join(runtime,'package.json'));
  const {makeRelease, startStandinRegistry} = await import(pathToFileURL(require.resolve('@sublang/spex/testing')));
  const {RegistryClient, publishRelease} = await import(pathToFileURL(require.resolve('@sublang/spex/environment')));
  const {hasPrivatePermissions, writeApplicationFile} = await import(pathToFileURL(require.resolve('@sublang/spex/files')));
  const permissions = windows ? require('@openclaw/fs-safe/permissions') : null;
  const descriptor = path => {
    const facts = permissions.readOwnerAndDacl(path);
    assert.equal(facts.status,'supported');
    assert.ok(facts.complete && facts.daclPresent);
    return {ownerSid:facts.ownerSid, aces:facts.aces};
  };
  for (const timing of windows ? ['before-core-start','after-core-start'] : ['ordinary-filesystem']) await t.test(timing, async () => {
    const root = mkdtempSync(join(tmpdir(),'sublang install 中文 '));
    const home = join(root,'home'), project = join(root,'project'), user = join(root,'user');
    for (const p of [home,project,user,join(project,'.spex')]) mkdirSync(p,{recursive:true});
    execFileSync('git',['init','-q',project]);
    const registry = await startStandinRegistry({dir:join(root,'registry')});
    let core;
    try {
      const fixture = await makeRelease(join(root,'release'), {format:2,org:'acceptance',name:workflow,version:'1.0.0',description:'Windows package installation regression fixture',license:'Apache-2.0',artifacts:{[workflow]:{kind:'playbook',language:'en'}}}, {
        [`playbooks/en/${workflow}/${workflow}.md`]:source,
        [`playbooks/en/${workflow}/${workflow}.registry.ts`]:registryModule,
        [`playbooks/en/${workflow}/${workflow}.registry.mjs`]:registryModule,
      });
      await publishRelease(new RegistryClient({url:registry.url}),fixture);
      writeFileSync(join(project,'spex.yaml'),`format: 1\nregistry: ${registry.url}\npackages: {}\n`);
      const env = {...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
      for (const k of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN']) delete env[k];
      const paths = [home,project,join(project,'.spex')];
      const widen = () => { for (const path of paths) grant(path,'(OI)(CI)(RX)'); };
      if (windows && timing==='before-core-start') widen();
      core = await connect({runtime,home,coreOptions:{home:user,env,watchConfig:false,agentSignIn:async()=>({state:'signed-out'})}});
      const invoke = async (operation,extra=[]) => {
        const r = await run(process.execPath,[join(runtime,'scripts/sublang.mjs'),operation,'--project',project,'--spex-home',home,'--host-agent','codex','--wait-seconds','60',...extra],{env,timeout:90000,maxBuffer:8*1024*1024});
        const value = JSON.parse(r.stdout);
        assert.equal(value.ok,true,r.stdout);
        return value.result;
      };
      await invoke('project-add');
      if (windows && timing==='after-core-start') widen();
      const before = windows ? paths.map(descriptor) : null;
      if (windows) for (const d of before) assert.ok(d.aces.some(a=>a.aceType==='allow' && a.sid.toLowerCase()===EVERYONE && a.mask!==0),'fixture must really carry the extra read grant');
      await invoke('package-add',['--package',packageName,'--version','1.0.0']);
      const packages = await invoke('packages');
      const installed = packages.packages.find(p=>p.name===packageName);
      assert.equal(installed.version,'1.0.0'); assert.equal(installed.installed,true);
      const file = join(project,'.spex/packages/acceptance/storage-probe/playbooks/en/storage-probe/storage-probe.md');
      assert.equal(readFileSync(file,'utf8'),source);
      assert.ok(readFileSync(join(project,'spex.lock'),'utf8').includes(packageName));
      const catalog = await invoke('catalog');
      assert.ok(catalog.workflows.some(w=>w.name===workflow && w.present && w.runs),'installed Playbook must be available without execution');
      let diagnostic = await invoke('runtime-check');
      assert.equal(diagnostic.aligned,true,JSON.stringify(diagnostic.issues));
      assert.ok(diagnostic.workflows.length>=8,'all seven built-ins plus the installed fixture are checked');
      for (const row of diagnostic.workflows) {
        assert.equal(row.status,'aligned',row.module);
        assert.ok(row.imports.some(i=>i.resolved?.name==='@sublang/playbook'));
      }
      // Model an existing installation pointing into an older cache. Only
      // temporary fixture links change; Core's ordinary preparation repairs
      // it on restart, without editing user config or package versions.
      await core.close(); core=null;
      const artifact = join(project,'.spex/packages/acceptance/storage-probe/playbooks/en/storage-probe');
      const old = join(root,'old-cache','node_modules','@sublang','playbook');
      mkdirSync(old,{recursive:true});
      writeFileSync(join(old,'package.json'),JSON.stringify({name:'@sublang/playbook',version:'18.1.3',exports:{'./xstate-runtime':'./index.js'}}));
      writeFileSync(join(old,'index.js'),'export {};\n');
      const link = join(artifact,'node_modules','@sublang','playbook');
      rmSync(link,{recursive:true,force:true});
      symlinkSync(old,link,windows?'junction':'dir');
      assert.equal(realpathSync(link),realpathSync(old));
      core=await connect({runtime,home,coreOptions:{home:user,env,watchConfig:false,agentSignIn:async()=>({state:'signed-out'})}});
      diagnostic=await invoke('runtime-check');
      assert.equal(diagnostic.aligned,true,JSON.stringify(diagnostic.issues));
      const row=diagnostic.workflows.find(w=>w.id===workflow);
      assert.equal(row.status,'aligned');
      assert.equal(realpathSync(link),realpathSync(join(runtime,'node_modules/@sublang/playbook')));
      assert.equal(row.imports.find(i=>i.resolved?.name==='@sublang/playbook').resolved.version,'18.1.4');
      // A user-owned real dependency directory must stay intact, but it
      // cannot silently supply another engine to a new workflow run.
      await core.close(); core=null;
      rmSync(link,{recursive:true,force:true});
      mkdirSync(link);
      writeFileSync(join(link,'package.json'),readFileSync(join(old,'package.json')));
      writeFileSync(join(link,'index.js'),'export {};\n');
      core=await connect({runtime,home,coreOptions:{home:user,env,watchConfig:false,agentSignIn:async()=>({state:'signed-out'})}});
      diagnostic=await invoke('runtime-check');
      assert.equal(diagnostic.aligned,false);
      assert.equal(diagnostic.workflows.find(w=>w.id===workflow).status,'unverified');
      assert.equal(JSON.parse(readFileSync(join(link,'package.json'),'utf8')).version,'18.1.3');
      const request=join(root,'request.txt'); writeFileSync(request,'Do not execute: the engine must be refused.');
      await assert.rejects(invoke('run',['--workflow',workflow,'--request-file',request]),error=>JSON.parse(error.stdout).error.code==='runtime_mismatch');
      assert.deepEqual(await invoke('sessions'),[],'installation must never create or run a workflow session');
      if (windows) {
        assert.deepEqual(paths.map(descriptor),before,'installation must not rewrite existing directory ACLs');
        // Narrow integrity checks still reject an actual write grant; the
        // regression is about read grants, not admitting mutable lease data.
        const mutable = join(home,'write-grant-probe.json');
        writeApplicationFile(mutable,{fixture:true});
        grant(mutable,'(M)');
        const {lstatSync} = await import('node:fs');
        assert.equal(hasPrivatePermissions(mutable,lstatSync(mutable)),false);
      }
      assert.equal(existsSync(join(project,'specs')),false);
    } finally {
      if (core) await core.close();
      await registry.close();
      rmSync(root,{recursive:true,force:true});
    }
  });
});
