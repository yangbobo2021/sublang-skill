#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { connect, SkillError } from './client.mjs';
import { execute, HELP } from './operations.mjs';
import { absolutePath } from './platform.mjs';
import { ensureAgent, hostSelection, readAgentRecord, NON_INITIALIZING_OPERATIONS } from './agent-config.mjs';

const optionNames = ['project','spex-home','wait-seconds','scope','query','workflow','json-file','session','after-seq','request-file','kind','action','draft','instance','source-file','base-version','player','package','version','path','git','rev','host-agent','host-model'];
let connection, cancel, stopping = false;
const controller = new AbortController();
const emit = event => process.stderr.write(JSON.stringify(event) + '\n');
const interrupt = async () => {
  if (stopping) return; stopping = true;
  controller.abort();
  try { await cancel?.(); } catch (error) { emit({event: 'cancel_failed', code: error.code || 'error', message: error.message}); }
};
try {
  const {values, positionals} = parseArgs({options: Object.fromEntries(optionNames.map(name => [name, {type: 'string'}])), allowPositionals: true, strict: true});
  if (positionals.length > 1) throw new SkillError('invalid_argument', 'Only one operation is allowed.');
  const operation = positionals[0] || 'help';
  if (!(operation in HELP.operations)) throw new SkillError('unknown_operation', `Unknown operation ${operation}; use help.`);
  if (operation === 'help') process.stdout.write(JSON.stringify(HELP, null, 2) + '\n');
  else {
    const seconds = Number(values['wait-seconds'] || 1800);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new SkillError('invalid_argument', '--wait-seconds must be positive.');
    if (!absolutePath(values.project)) throw new SkillError('project_required', '--project requires an absolute project root.');
    const home = resolve(values['spex-home'] || process.env.SPEX_HOME || resolve(homedir(), '.spex'));
    const savedAgent = readAgentRecord(home);
    // A diagnostic must not start Core and expose its credential-based seed
    // as though it were the Skill's saved choice. Workflow preparation is an
    // explicit, idempotent operation; an absent record is a normal first use.
    if (operation === 'settings' && savedAgent?.status !== 'ready') {
      process.stdout.write(JSON.stringify({ok: true, operation, result: {
        initializationState: savedAgent?.status || 'uninitialized', initialization: savedAgent,
        config: {status: 'not_loaded', reason: 'agent_uninitialized'}, readiness: [],
        next: {operation: 'preflight', message: 'For a workflow request, run preflight with the current host Agent/model before comparing configuration. Missing initialization is a first-use state, not a configuration conflict. A settings-only request remains read-only.'},
      }}) + '\n');
    } else {
      const managesAgent = !NON_INITIALIZING_OPERATIONS.has(operation);
      if (managesAgent && (operation === 'agent-configure' || !savedAgent)) hostSelection(values);
      process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
      const deadline = setTimeout(interrupt, seconds * 1000);
      try {
        connection = await connect({runtime: resolve(dirname(fileURLToPath(import.meta.url)), '..'), home, emit});
        if (controller.signal.aborted) throw new SkillError('interrupted', 'Canceled during SPEX connection preparation; no workflow was submitted.');
        emit({event: 'core', mode: connection.owned ? 'temporary' : 'attached'});
        const agent = managesAgent ? await ensureAgent(connection.client, home, values, {reset: operation === 'agent-configure', emit, signal: controller.signal}) : readAgentRecord(home);
        let result = operation === 'agent-init' || operation === 'agent-configure' ? {initialization: agent, config: await connection.client.request('config.get')} :
          await execute(connection.client, operation, values, {emit, signal: controller.signal, onCancel: fn => { cancel = fn; if (fn && controller.signal.aborted) void fn().catch(() => {}); }});
        if (['project-add','package-add','package-install','package-update','draft-register'].includes(operation)) {
          await ensureAgent(connection.client, home, values, {emit, signal: controller.signal});
        }
        if (operation === 'settings' || operation === 'preflight') {
          result.initialization = agent;
          result.initializationState = agent?.status || 'uninitialized';
        }
        if (controller.signal.aborted) throw new SkillError('interrupted', 'Operation deadline or signal interrupted work; inspect retained task state.');
        process.stdout.write(JSON.stringify({ok: true, operation, result}) + '\n');
      } finally { clearTimeout(deadline); }
    }
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ok: false, error: {code: error.code || 'operation_failed', message: error.message, ...(error.details ? {details: error.details} : {})}}) + '\n');
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
  process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
}
