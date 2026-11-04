import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { connect } from '../scripts/client.mjs';
import { ensureAgent } from '../scripts/agent-config.mjs';

test('real Core persists both host choices, new-player inheritance and explicit reconfiguration', {skip: !process.env.SUBLANG_TEST_RUNTIME, timeout: 180000}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'sublang Core 中文 '));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const project = join(root, 'project'), user = join(root, 'user'), home = join(root, 'spex');
  mkdirSync(project); mkdirSync(user);
  mkdirSync(join(user,'.codex')); mkdirSync(join(user,'.claude'));
  assert.equal(spawnSync('git', ['init','-q',project]).status, 0);
  const runtime = resolve(process.env.SUBLANG_TEST_RUNTIME);
  const env = {...process.env, HOME: user, USERPROFILE: user, CODEX_HOME: join(user,'.codex'), CLAUDE_CONFIG_DIR: join(user,'.claude')};
  for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN']) delete env[key];
  let signedIn = true;
  const start = () => connect({runtime, home, coreOptions: {home: user, env, agentSignIn: async () => ({state: signedIn ? 'signed-in' : 'signed-out'})}});
  let c = await start();
  try {
    const seed = await c.client.request('config.get');
    assert.equal(seed.summary.captain.adapter, 'claude');
    assert.equal(seed.summary.players.find(p => p.id === 'dev.reviewer').agent.adapter, 'codex');
    await c.client.request('config.edit', {op:{kind:'playbook.role.bind',playbookId:'review',role:'reviewer',playerId:'dev.reviewer',model:'gpt-6-sol'}});
    await ensureAgent(c.client, home, {project, 'host-agent':'codex', 'host-model':'gpt-6.1-sol'});
    const registered = await c.client.request('project.register', {path: project});
    await ensureAgent(c.client, home, {project});
    let state = await c.client.request('config.get', {projectId: registered.id});
    assert.equal(state.status, 'valid');
    assert.equal(state.summary.captain.adapter, 'codex');
    assert.ok(state.summary.players.every(p => p.agent.adapter === 'codex' && p.agent.model === 'gpt-6.1-sol'));
    assert.ok(state.summary.playbooks.every(p => Object.values(p.roles).every(b => b.model === undefined || b.model === 'gpt-6.1-sol')));
    const before = readFileSync(state.summary.path, 'utf8');
    await c.close(); signedIn = false; c = await start();
    await ensureAgent(c.client, home, {project, 'host-agent':'claude', 'host-model':'claude-other'});
    state = await c.client.request('config.get');
    assert.equal(readFileSync(state.summary.path, 'utf8'), before);
    // Readiness invokes Core's credential-based reseeding path. A completed
    // Skill initialization must survive it even with no real credentials.
    await c.client.request('readiness.get');
    assert.equal(readFileSync(state.summary.path, 'utf8'), before);
    await c.client.request('config.edit', {op:{kind:'playbook.role.bind',playbookId:'review',role:'reviewer',playerId:'dev.new_reviewer'}});
    await ensureAgent(c.client, home, {project});
    state = await c.client.request('config.get');
    const player = state.summary.players.find(p => p.id === 'dev.new_reviewer');
    assert.equal(player.agent.adapter, 'codex'); assert.equal(player.agent.model, 'gpt-6.1-sol'); assert.ok(!player.toSetUp);
    // Project settings bind distinct Players; model tuning belongs to the
    // personal configuration. New project-only Players must also inherit it.
    await c.client.request('config.edit', {repository:registered.id,op:{kind:'playbook.add',playbookId:'review',roles:{coder:'dev.project_coder',reviewer:'dev.project_reviewer'}}});
    await ensureAgent(c.client, home, {project});
    const projectState = await c.client.request('config.get',{projectId:registered.id});
    for (const id of ['dev.project_coder','dev.project_reviewer']) {
      const p = projectState.summary.players.find(p => p.id === id);
      assert.equal(p.agent.adapter,'codex'); assert.equal(p.agent.model,'gpt-6.1-sol'); assert.ok(!p.toSetUp);
    }
    await ensureAgent(c.client, home, {project, 'host-agent':'claude'}, {reset:true});
    state = await c.client.request('config.get');
    assert.equal(state.summary.captain.adapter, 'claude'); assert.equal(state.summary.captain.model, 'claude-opus-5-5');
    assert.ok(state.summary.players.every(p => p.agent.adapter === 'claude' && p.agent.model === 'claude-opus-5-5'));
    const effective = await c.client.request('config.get',{projectId:registered.id});
    assert.equal(effective.status,'valid');
    assert.equal(effective.summary.playbooks.find(p => p.id === 'review').roles.reviewer.model,undefined);
    const claudeBefore = readFileSync(state.summary.path, 'utf8');
    await c.close(); c = await start();
    await c.client.request('readiness.get');
    state = await c.client.request('config.get');
    assert.equal(readFileSync(state.summary.path, 'utf8'), claudeBefore);
    assert.equal(state.summary.captain.model, 'claude-opus-5-5');
  } finally { await c.close(); }
});

test('native CLI fails before Core without a first host, initializes Claude with its fallback and preserves saved config', {skip: !process.env.SUBLANG_TEST_RUNTIME, timeout: 180000}, t => {
  const root = mkdtempSync(join(tmpdir(), 'sublang CLI 中文 '));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const home = join(root,'spex'), project = join(root,'project'), user = join(root,'user');
  mkdirSync(project); mkdirSync(user);
  assert.equal(spawnSync('git',['init','-q',project]).status, 0);
  const env = {...process.env, HOME:user, USERPROFILE:user, CODEX_HOME:join(user,'.codex'), CLAUDE_CONFIG_DIR:join(user,'.claude')};
  for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN']) delete env[key];
  const invoke = (operation, extra = []) => {
    const result = spawnSync(process.execPath, [join(process.env.SUBLANG_TEST_RUNTIME,'scripts/sublang.mjs'),operation,'--project',project,'--spex-home',home,...extra], {env,encoding:'utf8',timeout:60000});
    assert.ifError(result.error);
    return {...result, json:JSON.parse(result.stdout)};
  };
  let result = invoke('catalog');
  assert.equal(result.status, 1); assert.equal(result.json.error.code,'host_agent_required');
  assert.equal(existsSync(home), false);
  result = invoke('catalog',['--host-agent','claude']);
  assert.equal(result.status,0,result.stdout + result.stderr);
  result = invoke('settings');
  assert.equal(result.status,0,result.stdout + result.stderr);
  assert.equal(result.json.result.initialization.status,'ready');
  assert.equal(result.json.result.config.summary.captain.adapter,'claude');
  assert.equal(result.json.result.config.summary.captain.model,'claude-opus-5-5');
  const path = result.json.result.config.summary.path, bytes = readFileSync(path,'utf8');
  result = invoke('catalog',['--host-agent','codex','--host-model','gpt-6.1-sol']);
  assert.equal(result.status,0,result.stdout + result.stderr);
  assert.equal(readFileSync(path,'utf8'),bytes);
  result = invoke('agent-configure',['--host-agent','codex','--host-model','gpt-6.1-sol']);
  assert.equal(result.status,0,result.stdout + result.stderr);
  assert.equal(result.json.result.config.summary.captain.adapter,'codex');
});

test('settings-first workflow preparation distinguishes first use from conflict for both hosts', {skip: !process.env.SUBLANG_TEST_RUNTIME, timeout:180000}, async t => {
  for (const host of ['codex','claude']) await t.test(host, async t => {
    const root = mkdtempSync(join(tmpdir(),'sublang preflight 中文 '));
    t.after(() => rmSync(root,{recursive:true,force:true}));
    const home = join(root,'spex'), project = join(root,'project'), user = join(root,'user');
    mkdirSync(project); mkdirSync(user);
    assert.equal(spawnSync('git',['init','-q',project]).status,0);
    const env = {...process.env, HOME:user, USERPROFILE:user, CODEX_HOME:join(user,'.codex'), CLAUDE_CONFIG_DIR:join(user,'.claude')};
    for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN']) delete env[key];
    const runtime = resolve(process.env.SUBLANG_TEST_RUNTIME);
    const invoke = (operation, extra=[]) => {
      const r = spawnSync(process.execPath,[join(runtime,'scripts/sublang.mjs'),operation,'--project',project,'--spex-home',home,...extra],{env,encoding:'utf8',timeout:60000});
      assert.ifError(r.error); assert.equal(r.status,0,r.stdout+r.stderr);
      return {result:JSON.parse(r.stdout).result, events:r.stderr};
    };
    // This is the route that previously stopped before initialization.
    let diagnostic = invoke('settings');
    assert.equal(diagnostic.result.initializationState,'uninitialized');
    assert.equal(diagnostic.result.initialization,null);
    assert.equal(diagnostic.result.config.status,'not_loaded');
    assert.equal(diagnostic.result.next.operation,'preflight');
    assert.equal(existsSync(home),false);
    assert.equal(diagnostic.events,'');
    // Existing Core-generated Claude defaults are not a saved Skill choice.
    const core = await connect({runtime,home,coreOptions:{home:user,env,agentSignIn:async()=>({state:'signed-out'})}});
    let seed;
    try { seed = await core.client.request('config.get'); }
    finally { await core.close(); }
    const before = readFileSync(seed.summary.path,'utf8');
    assert.equal(seed.summary.captain.adapter,'claude');
    diagnostic = invoke('settings');
    assert.equal(diagnostic.result.initializationState,'uninitialized');
    assert.equal(diagnostic.result.config.status,'not_loaded');
    assert.equal(readFileSync(seed.summary.path,'utf8'),before);
    assert.equal(existsSync(join(home,'local/skill-agent.json')),false);
    const args = ['--host-agent',host,...(host==='codex'?['--host-model','gpt-6.1-sol']:[])];
    const prepared = invoke('preflight',args).result;
    const expectedModel = host==='codex'?'gpt-6.1-sol':'claude-opus-5-5';
    assert.equal(prepared.initializationState,'ready');
    assert.equal(prepared.initialization.status,'ready');
    assert.equal(prepared.config.summary.captain.adapter,host);
    assert.equal(prepared.config.summary.captain.model,expectedModel);
    assert.ok(prepared.config.summary.players.every(p=>p.agent.adapter===host && p.agent.model===expectedModel));
    const configured = readFileSync(seed.summary.path,'utf8');
    const checked = invoke('settings').result;
    assert.equal(checked.initializationState,'ready');
    assert.equal(checked.config.summary.captain.model,expectedModel);
    // A later host cannot reset the saved choice; preparing never submits a
    // workflow or resumes the historical session from a previous host.
    invoke('preflight',['--host-agent',host==='codex'?'claude':'codex']);
    assert.equal(readFileSync(seed.summary.path,'utf8'),configured);
    invoke('project-add');
    assert.deepEqual(invoke('sessions').result,[]);
  });
});
