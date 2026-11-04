import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostSelection, ensureAgent, readAgentRecord } from '../scripts/agent-config.mjs';

test('host identity is explicit; each host uses its own model fallback', () => {
  assert.deepEqual(hostSelection({'host-agent': 'codex'}), {adapter: 'codex', model: 'gpt-6.1-sol', modelSource: 'default'});
  assert.deepEqual(hostSelection({'host-agent': 'claude'}), {adapter: 'claude', model: 'claude-opus-5-5', modelSource: 'default'});
  assert.equal(hostSelection({'host-agent': 'codex', 'host-model': 'current-codex-model'}).model, 'current-codex-model');
  assert.equal(hostSelection({'host-agent': 'claude', 'host-model': 'current-claude-model'}).modelSource, 'host');
  for (const args of [{}, {'host-agent': 'toString'}, {'host-agent': 'other'}, {'host-agent': 'codex', 'host-model': ''}]) assert.throws(() => hostSelection(args));
});

// A protocol double exercises locking/journaling without model or network calls.
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'sublang agent 中文 '));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  let writes = 0, fail = false;
  const state = {status: 'valid', revision: 'r0', summary: {path: join(home, 'config.yaml'),
    captain: {adapter: 'claude', model: 'claude-old'},
    players: [{id: 'dev.coder', agent: {adapter: 'claude', model: 'claude-old'}}, {id: 'dev.reviewer', agent: {adapter: 'codex', model: 'review-old'}}],
    playbooks: [{id: 'review', roles: {coder: {playerId: 'dev.coder'}, reviewer: {playerId: 'dev.reviewer', model: 'review-old'}}}]}};
  writeFileSync(state.summary.path, 'fixture');
  const client = {async request(type, fields) {
    if (type === 'config.get') return structuredClone(state);
    if (type === 'project.list' || type === 'session.list') return [];
    assert.equal(type, 'config.batch');
    if (fail) throw new Error('write failed');
    assert.equal(fields.revision, state.revision);
    writes++;
    for (const op of fields.ops) {
      if (op.kind === 'captain.set') Object.assign(state.summary.captain, op.patch);
      else if (op.kind === 'player.set') {
        let p = state.summary.players.find(p => p.id === op.playerId);
        if (!p) state.summary.players.push(p = {id: op.playerId, agent: {}});
        Object.assign(p.agent, op.patch); delete p.toSetUp;
      } else {
        const role = state.summary.playbooks.find(p => p.id === op.playbookId).roles[op.role];
        for (const key of ['model','effort','fastMode','subagentModel','subagentEffort']) delete role[key];
      }
    }
    state.revision = 'r' + writes;
    return structuredClone(state);
  }};
  return {home, state, client, writes: () => writes, fail: value => { fail = value; }};
}

test('first host configures the whole roster; later hosts and models never reset it', async t => {
  const f = fixture(t);
  await ensureAgent(f.client, f.home, {'host-agent': 'codex', project: f.home});
  assert.equal(f.state.summary.captain.adapter, 'codex');
  assert.ok(f.state.summary.players.every(p => p.agent.model === 'gpt-6.1-sol'));
  assert.deepEqual(f.state.summary.players.map(p => p.id), ['dev.coder', 'dev.reviewer']);
  assert.equal(f.state.summary.playbooks[0].roles.reviewer.model, undefined);
  const bytes = readFileSync(join(f.home, 'local/skill-agent.json'), 'utf8');
  await ensureAgent(f.client, f.home, {'host-agent': 'claude', 'host-model': 'another', project: f.home});
  assert.equal(f.writes(), 1);
  assert.equal(readFileSync(join(f.home, 'local/skill-agent.json'), 'utf8'), bytes);
  // Preserve a user's later customization; initialize only the new player.
  f.state.summary.players[0].agent.model = 'custom-player-model';
  f.state.summary.players.push({id: 'dev.new', agent: {adapter: 'claude', model: 'package-old'}, toSetUp: true});
  await ensureAgent(f.client, f.home, {project: f.home});
  assert.equal(f.state.summary.players[0].agent.model, 'custom-player-model');
  assert.equal(f.state.summary.players.at(-1).agent.adapter, 'codex');
  assert.equal(f.state.summary.players.at(-1).agent.model, 'gpt-6.1-sol');
  await ensureAgent(f.client, f.home, {'host-agent': 'claude', project: f.home}, {reset: true});
  assert.ok(f.state.summary.players.every(p => p.agent.adapter === 'claude' && p.agent.model === 'claude-opus-5-5'));
});

test('failed initialization retains its original choice and retries without changing provider', async t => {
  const f = fixture(t); f.fail(true);
  await assert.rejects(ensureAgent(f.client, f.home, {'host-agent': 'codex', 'host-model': 'selected-model', project: f.home}), /write failed/);
  assert.equal(readAgentRecord(f.home).status, 'pending');
  f.fail(false);
  await ensureAgent(f.client, f.home, {'host-agent': 'claude', project: f.home});
  assert.equal(readAgentRecord(f.home).status, 'ready');
  assert.equal(f.state.summary.captain.model, 'selected-model');
  assert.equal(f.state.summary.captain.adapter, 'codex');
});

test('concurrent initializer and malformed state fail without configuration writes', async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, 'local/skill-agent.lock'), {recursive: true});
  await assert.rejects(ensureAgent(f.client, f.home, {'host-agent': 'codex'}), {code: 'agent_config_busy'});
  assert.equal(f.writes(), 0);
  rmSync(join(f.home, 'local/skill-agent.lock'), {recursive: true});
  writeFileSync(join(f.home, 'local/skill-agent.json'), '{bad');
  await assert.rejects(ensureAgent(f.client, f.home, {'host-agent': 'codex'}), {code: 'invalid_agent_record'});
  assert.equal(f.writes(), 0);
});
