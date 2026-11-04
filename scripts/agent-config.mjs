// Host choice belongs to the calling Skill, not to credential discovery.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SkillError } from './client.mjs';
import { sameDirectory } from './platform.mjs';

export const DEFAULT_MODELS = Object.freeze({codex: 'gpt-6.1-sol', claude: 'claude-opus-5-5'});
export const NON_INITIALIZING_OPERATIONS = new Set(['settings', 'sessions', 'status', 'history', 'approvals', 'approval-respond', 'abort', 'control']);
const recordPath = home => join(home, 'local', 'skill-agent.json');

export function hostSelection(args) {
  const adapter = args['host-agent'];
  if (!(adapter in DEFAULT_MODELS) || !Object.hasOwn(DEFAULT_MODELS, adapter)) {
    throw new SkillError('host_agent_required', 'First use requires --host-agent codex|claude supplied by the calling host; credentials do not identify the host.');
  }
  const model = args['host-model'] ?? DEFAULT_MODELS[adapter];
  if (typeof model !== 'string' || !model.trim() || /[\r\n\0]/.test(model) || model.length > 200) {
    throw new SkillError('invalid_model', '--host-model must be a nonempty model identifier from reliable current-host metadata.');
  }
  return {adapter, model: model.trim(), modelSource: args['host-model'] === undefined ? 'default' : 'host'};
}

export function readAgentRecord(home) {
  let record;
  try { record = JSON.parse(readFileSync(recordPath(home), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new SkillError('invalid_agent_record', 'Cannot read the Skill agent initialization record; no configuration was changed.');
  }
  if (record.format !== 1 || !['pending', 'ready'].includes(record.status) ||
      !Object.hasOwn(DEFAULT_MODELS, record.selection?.adapter) || typeof record.selection?.model !== 'string' || !record.selection.model ||
      !Array.isArray(record.players) || !Array.isArray(record.roles)) {
    throw new SkillError('invalid_agent_record', 'Malformed Skill agent initialization record; inspect it before retrying.');
  }
  return record;
}

function saveRecord(home, record) {
  const target = recordPath(home), temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
    renameSync(temp, target);
  } finally { rmSync(temp, {force: true}); }
}

function valid(state) {
  if (state.status !== 'valid') throw new SkillError('invalid_config', 'Agent initialization needs a valid SPEX configuration; no workflow was started.', state);
  return state.summary;
}

function patchAgent(agent, selection) {
  const permissions = {...(agent.permissions || {})};
  // The native Codex sandbox needs the same Git metadata grant as its seed.
  if (selection.adapter === 'codex') permissions.writablePaths = [...new Set([...(permissions.writablePaths || []), '.git'])];
  return {
    adapter: selection.adapter, model: selection.model,
    effort: null, fastMode: null, browser: null,
    subagentModel: null, subagentEffort: null,
    ...(Object.keys(permissions).length ? {permissions} : {}),
  };
}

const roleKey = (scope, id, role) => JSON.stringify([scope, id, role]);
const roleOp = (playbook, role, binding) => ({kind: 'playbook.role.bind', playbookId: playbook.id, role,
  playerId: binding.playerId, model: null, effort: null, fastMode: null, subagentModel: null, subagentEffort: null});

/** Initialize once, or explicitly replace the configured choice. Later calls
 * only materialize newly discovered players and clear new role default pins.
 * All personal agent/role changes use the Core's revisioned atomic batch.
 * A pending journal retains the first selection across interrupted retries.
 */
export async function ensureAgent(client, home, args, {reset = false, emit = () => {}, signal} = {}) {
  const local = join(home, 'local'), lock = join(local, 'skill-agent.lock');
  mkdirSync(local, {recursive: true});
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new SkillError('agent_config_busy', 'Another Skill agent initialization may be active; retry after it finishes. No lock was removed.');
  }
  try {
    const check = () => { if (signal?.aborted) throw new SkillError('interrupted', 'Agent initialization interrupted; no workflow was submitted.'); };
    check();
    let record = readAgentRecord(home);
    const initializing = reset || !record || record.status === 'pending';
    const selection = reset || !record ? hostSelection(args) : record.selection;
    const ownState = await client.request('config.get');
    const own = valid(ownState);
    if (!reset && record?.configPath && !sameDirectory(record.configPath, own.path)) {
      throw new SkillError('agent_config_moved', 'The personal configuration path changed; explicitly agent-configure this environment before using workflows.');
    }
    const projects = await client.request('project.list');
    const project = projects.find(p => sameDirectory(p.path, args.project));
    // Journal before the first write: retrying from another host cannot pick
    // a different agent after an interrupted first initialization.
    if (reset || !record) {
      const active = (await client.request('session.list')).filter(s => s.turnActive || s.externalWriter);
      if (active.length) throw new SkillError('agent_config_busy', 'Stop active SPEX turns before initializing or replacing the shared Agent configuration.', {sessionIds: active.map(s => s.id)});
      record = {format: 1, status: 'pending', selection, configPath: own.path, players: [], roles: []};
      saveRecord(home, record);
    }
    const knownPlayers = new Set(record.players), knownRoles = new Set(record.roles);
    const defaults = initializing ? selection : {adapter: own.captain.adapter, model: own.captain.model};
    if (!defaults.model) throw new SkillError('agent_model_missing', 'The configured Captain has no explicit model; use agent-configure to select one.');
    const ops = initializing ? [{kind: 'captain.set', patch: patchAgent(own.captain, selection)}] : [];
    for (const player of own.players) {
      if (initializing || player.toSetUp || !knownPlayers.has(player.id)) {
        ops.push({kind: 'player.set', playerId: player.id, patch: patchAgent(player.agent, defaults)});
      }
      knownPlayers.add(player.id);
    }
    for (const playbook of own.playbooks) for (const [role, binding] of Object.entries(playbook.roles)) {
      const key = roleKey('personal', playbook.id, role);
      if (initializing || !knownRoles.has(key)) ops.push(roleOp(playbook, role, binding));
      knownRoles.add(key);
    }
    check();
    if (ops.length) {
      if (!ownState.revision) throw new SkillError('missing_config_revision', 'Core did not return the revision needed for atomic Agent initialization.');
      valid(await client.request('config.batch', {revision: ownState.revision, ops}));
    }
    // Project defaults may introduce more Players after package installation.
    // Their identities remain distinct; only their default Agent is inherited.
    if (project) {
      const effective = valid(await client.request('config.get', {projectId: project.id}));
      const state = await client.request('config.get');
      const added = effective.players.filter(p => p.toSetUp || !knownPlayers.has(p.id));
      if (added.length) {
        check();
        valid(await client.request('config.batch', {revision: state.revision, ops: added.map(p => ({kind: 'player.set', playerId: p.id, patch: patchAgent(p.agent, defaults)}))}));
        for (const p of added) knownPlayers.add(p.id);
      }
      // SPEX project settings allow role-to-Player bindings only, not model
      // tuning. Model overrides belong to the personal batch above. Never
      // manufacture project-local tuning operations to work around that rule.
    }
    check();
    const final = valid(await client.request('config.get', project ? {projectId: project.id} : {}));
    // Initialization is not reported as complete until the effective config,
    // including project role overrides, actually runs on the selected model.
    if (initializing) {
      const wrong = [final.captain, ...final.players.map(p => p.agent)].some(a => a.adapter !== selection.adapter || a.model !== selection.model);
      const overridden = final.playbooks.some(p => Object.values(p.roles).some(b => b.model !== undefined && b.model !== selection.model));
      if (wrong || overridden) throw new SkillError('agent_config_mismatch', 'Effective Agent/model did not match the calling host; no workflow was started.');
    }
    const next = {...record, status: 'ready', players: [...knownPlayers].sort(), roles: [...knownRoles].sort()};
    if (JSON.stringify(next) !== JSON.stringify(record)) saveRecord(home, next);
    if (initializing || ops.length) emit({event: 'agent_configured', adapter: final.captain.adapter, model: final.captain.model, modelSource: selection.modelSource, configPath: own.path, initialized: initializing});
    return next;
  } finally { rmSync(lock, {recursive: true, force: true}); }
}
