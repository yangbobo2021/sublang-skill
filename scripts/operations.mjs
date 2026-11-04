import { readFileSync } from 'node:fs';
import { SkillError, projectPath } from './client.mjs';
import { sameDirectory } from './platform.mjs';

export const HELP = {
  usage: '<node> <cli> <operation> --project /absolute/git-root [options]',
  common: {'--spex-home': 'SPEX home; defaults to SPEX_HOME or ~/.spex', '--wait-seconds': 'Operation deadline; default 1800', '--scope': 'project (default) or personal for draft/package/config operations', '--host-agent': 'codex|claude, required on first use; later host changes do not reset configuration', '--host-model': 'Reliable current-host model; omit to use the adapter default on first use'},
  operations: {
    help: '', catalog: '[--query words]', inspect: '--workflow id [--package org/name]', 'project-add': '',
    settings: '(read-only; uninitialized environments return next: preflight without opening Core)',
    preflight: '--host-agent codex|claude [--host-model model] (prepare once, then read effective settings; no workflow submission)',
    configure: '--json-file config-edit-op.json',
    'agent-init': '--host-agent codex|claude [--host-model model] (initialize once)',
    'agent-configure': '--host-agent codex|claude [--host-model model] (explicitly replace Captain/Players and personal role overrides)',
    run: '--workflow id [--package org/name] --request-file request.txt', continue: '--session uuid --request-file followup.txt',
    sessions: '', status: '--session uuid', history: '--session uuid [--after-seq n]',
    abort: '--session uuid', control: '--session uuid --kind recovery|ending --action advertised-id',
    approvals: '', 'approval-respond': '--json-file decision.json',
    'draft-create': '--draft id', 'draft-open': '--draft id',
    'draft-write': '--draft id --instance uuid --source-file procedure.md [--base-version last-read-hash]',
    'draft-player': '--draft id --instance uuid --player configured-player-id',
    'draft-compile': '--draft id --instance uuid', 'draft-artifacts': '--draft id',
    'draft-register': '--draft id --instance uuid --json-file registration.json',
    'draft-delete': '--draft id --instance uuid', packages: '',
    'package-search': '--query words',
    'package-add': '--package org/name (--version range | --path project-relative-folder | --git url --rev revision)',
    'package-install': '', 'package-update': '', 'package-remove': '--package org/name',
  },
};

export function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new SkillError('argument_required', `--${name} is required.`);
  return value;
}
function textFile(args, name) { return readFileSync(required(args, name), 'utf8'); }
function jsonFile(args) {
  const result = JSON.parse(textFile(args, 'json-file'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new SkillError('invalid_input', 'JSON input must be an object.');
  return result;
}
const sleep = ms => new Promise(yes => setTimeout(yes, ms));

export async function execute(client, operation, args, {emit = () => {}, signal, onCancel = () => {}} = {}) {
  // Cancellation fences every subsequent protocol operation, including the
  // discovery-to-submission window. Abort commands themselves stay usable.
  const transport = client;
  client = {request(type, ...rest) {
    if (signal?.aborted && type !== 'turn.abort' && type !== 'draft.abort') throw new SkillError('interrupted', 'Canceled before sending another SPEX operation.');
    return transport.request(type, ...rest);
  }};
  const root = projectPath(required(args, 'project'));
  const projects = await client.request('project.list');
  let project = projects.find(p => sameDirectory(p.path, root));
  if (operation === 'project-add') {
    return {project: project || await client.request('project.register', {path: root}), alreadyRegistered: !!project};
  }
  const requireProject = () => {
    if (!project) throw new SkillError('project_not_registered', 'Use project-add for this project before running or authoring its workflows.', {project: root});
    return project.id;
  };
  const scopedRepository = async () => {
    if ((args.scope || 'project') === 'project') return requireProject();
    if (args.scope !== 'personal') throw new SkillError('invalid_scope', '--scope is project or personal.');
    const space = await client.request('space.get');
    const own = space.own.repositories.find(row => row.own);
    if (!own) throw new SkillError('personal_environment_missing', 'SPEX did not report the personal environment.');
    return own.key;
  };
  const personalRepository = async () => {
    const space = await client.request('space.get');
    return space.own.repositories.find(row => row.own)?.key;
  };
  const catalog = async () => {
    const result = await client.request('environment.playbooks', project ? {projectId: project.id} : {});
    const unique = new Map();
    for (const row of [...result.own, ...(result.project || [])]) unique.set(`${row.package}:${row.name}`, row);
    const personal = await personalRepository();
    const drafts = (await client.request('draft.list')).filter(d => d.projectId === personal || (project && d.projectId === project.id)).map(d => ({...d, scope: d.projectId === personal ? 'personal' : 'project'}));
    return {project: root, projectRegistered: !!project, workflows: [...unique.values()], drafts, invalid: result.invalid || [], ...(!project ? {next: 'project-add to include this project’s effective local workflows'} : {})};
  };
  const findWorkflow = async () => {
    requireProject();
    const requested = required(args, 'workflow');
    const rows = (await catalog()).workflows;
    const named = rows.filter(row => row.name === requested);
    let found = named.length ? named : rows.filter(row => row.id === requested);
    if (args.package) found = found.filter(row => row.package === args.package);
    // The core, not the Skill, decides which colliding definition composes.
    const runnable = found.filter(row => row.runs);
    if (found.length > 1 && runnable.length === 1 && !args.package) found = runnable;
    if (found.length !== 1) throw new SkillError(found.length ? 'ambiguous_workflow' : 'workflow_not_found', `Expected one current workflow for ${requested}; inspect catalog.`, {candidates: found});
    return found[0];
  };
  const session = async () => {
    requireProject();
    const id = required(args, 'session');
    const found = (await client.request('session.list')).find(row => row.id === id);
    if (!found || found.projectId !== project.id) throw new SkillError('session_not_found', 'The selected session does not belong to this project.', {sessionId: id});
    return found;
  };
  const waitTurn = async id => {
    while (true) {
      if (signal?.aborted) throw new SkillError('interrupted', 'Operation interrupted; inspect the retained session before continuing.', {sessionId: id});
      const row = (await client.request('session.list')).find(item => item.id === id);
      if (!row) throw new SkillError('session_missing', 'The running session is no longer listed.', {sessionId: id});
      if (!row.live && !row.turnActive) return row;
      await sleep(300);
    }
  };
  const finishTurn = async (id, afterSeq, submit) => {
    onCancel(() => client.request('turn.abort', {sessionId: id}));
    emit({event: 'session', sessionId: id, project: root});
    try {
      await submit();
      const state = await waitTurn(id);
      const history = await client.request('history.get', {sessionId: id, afterSeq});
      return {sessionId: id, state, ...history, outcome: 'turn_settled', note: 'Inspect actual runtime results and deliverables; settlement is not task success.'};
    } catch (error) {
      error.details = {...error.details, sessionId: id, project: root};
      throw error;
    } finally { onCancel(null); }
  };
  const draftRepository = operation.startsWith('draft-') ? await scopedRepository() : undefined;
  const draftFields = () => ({projectId: draftRepository, draftId: required(args, 'draft')});
  const draft = async () => {
    const opened = await client.request('draft.open', draftFields());
    if (args.instance !== undefined && args.instance !== opened.draft.instance) throw new SkillError('conflict', 'Draft instance changed; reopen the draft.');
    return opened;
  };
  const instanceFields = async () => {
    const opened = await draft();
    const instance = required(args, 'instance');
    if (instance !== opened.draft.instance) throw new SkillError('conflict', 'Draft instance changed; reopen the draft.');
    return {...draftFields(), instance};
  };

  switch (operation) {
    case 'catalog': {
      const result = await catalog();
      if (args.query) {
        const terms = args.query.toLowerCase().split(/\s+/).filter(Boolean);
        result.workflows = result.workflows.map(row => ({...row, matchScore: terms.filter(term => `${row.name} ${row.intent || ''} ${row.package}`.toLowerCase().includes(term)).length})).filter(row => row.matchScore).sort((a,b) => b.matchScore - a.matchScore);
        result.query = args.query;
      }
      result.drafts = result.drafts.map(({id, instance, projectId, scope, state, firstLine, package: pkg, sourcePath, added, ready}) => ({id, instance, projectId, scope, state, firstLine, package: pkg, sourcePath, added, ready}));
      return result;
    }
    case 'inspect': {
      const workflow = await findWorkflow();
      const artifacts = workflow.present ? await client.request('playbook.artifacts', {playbookId: workflow.name, repository: workflow.repository}) : null;
      return {workflow, artifacts};
    }
    case 'preflight':
    case 'settings': return {config: await client.request('config.get', project ? {projectId: project.id} : {}), readiness: await client.request('readiness.get')};
    case 'configure': {
      const scope = args.scope || 'project';
      return client.request('config.edit', {op: jsonFile(args), ...(scope === 'project' ? {repository: requireProject()} : scope === 'personal' ? {} : {repository: await scopedRepository()})});
    }
    case 'sessions': return (await client.request('session.list')).filter(row => row.projectId === requireProject());
    case 'status': return session();
    case 'history': {
      const row = await session();
      const afterSeq = Number(args['after-seq'] || 0);
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new SkillError('invalid_argument', '--after-seq is a nonnegative integer.');
      return client.request('history.get', {sessionId: row.id, afterSeq});
    }
    case 'run': {
      const workflow = await findWorkflow();
      if (!workflow.runs || !workflow.present || !workflow.command) throw new SkillError('workflow_blocked', 'The workflow is not runnable in this project.', {workflow});
      const input = textFile(args, 'request-file');
      if (!input.trim()) throw new SkillError('empty_request', 'The request file is empty.');
      emit({event: 'selected_workflow', id: workflow.name, package: workflow.package, version: workflow.version, command: workflow.command});
      const created = await client.request('session.create', {projectId: requireProject(), expectedWorkflow: {id: workflow.name, command: workflow.command, package: workflow.package, version: workflow.version}});
      return finishTurn(created.id, 0, () => client.request('turn.submit', {sessionId: created.id, text: `/${workflow.command.replace(/^\//, '')} ${input}`}));
    }
    case 'continue': {
      const row = await session();
      if (row.live || row.turnActive || row.externalWriter) throw new SkillError('busy', 'This session already has a writer.', {sessionId: row.id});
      if (!row.continuable) throw new SkillError('not_continuable', row.continuationReason || 'Inspect the runtime’s advertised recovery controls.', {sessionId: row.id, recovery: row.recovery, parked: row.parked});
      const input = textFile(args, 'request-file');
      if (!input.trim()) throw new SkillError('empty_request', 'The request file is empty.');
      const before = await client.request('history.get', {sessionId: row.id});
      const seq = Math.max(0, ...before.records.map(record => record.seq));
      return finishTurn(row.id, seq, () => client.request('turn.submit', {sessionId: row.id, text: input}));
    }
    case 'abort': return client.request('turn.abort', {sessionId: (await session()).id});
    case 'control': {
      const row = await session();
      const kind = required(args, 'kind'), actionId = required(args, 'action');
      if (!['recovery','ending'].includes(kind)) throw new SkillError('invalid_argument', '--kind is recovery or ending.');
      return finishTurn(row.id, 0, () => client.request('session.control', {sessionId: row.id, kind, actionId}));
    }
    case 'approvals': return client.request('approval.list');
    case 'approval-respond': return client.request('approval.respond', jsonFile(args));
    case 'draft-create': return client.request('draft.create', draftFields());
    case 'draft-open': return draft();
    case 'draft-write': {
      const opened = await draft();
      const fields = await instanceFields();
      if (opened.source && !args['base-version']) throw new SkillError('version_required', 'Replacing an existing source requires --base-version from draft-open.');
      return client.request('draft.source.write', {...fields, content: textFile(args, 'source-file'), ...(args['base-version'] ? {baseVersion: args['base-version']} : {})});
    }
    case 'draft-player': return client.request('draft.player.set', {...await instanceFields(), playerId: required(args, 'player')});
    case 'draft-compile': {
      const fields = await instanceFields();
      emit({event: 'draft', ...fields});
      onCancel(() => client.request('draft.abort', fields));
      try { return {result: await client.request('draft.compile', fields, Number(args['wait-seconds'] || 1800) * 1000), ...await draft()}; }
      catch (error) { try { error.details = {...error.details, ...await draft()}; } catch {} throw error; }
      finally { onCancel(null); }
    }
    case 'draft-artifacts': return client.request('draft.artifacts', draftFields());
    case 'draft-register': return client.request('draft.register', {...jsonFile(args), ...await instanceFields()});
    case 'draft-delete': return client.request('draft.delete', await instanceFields());
    case 'packages': return client.request('environment.get', {repository: await scopedRepository()});
    case 'package-search': {
      const query = required(args, 'query').trim();
      if (query.length > 200) throw new SkillError('invalid_argument', '--query must be at most 200 characters.');
      return client.request('environment.search', {repository: await scopedRepository(), query});
    }
    case 'package-add': {
      const sources = ['version', 'path', 'git'].filter(key => args[key] !== undefined);
      if (sources.length !== 1) throw new SkillError('invalid_argument', 'Choose exactly one of --version, --path, --git.');
      const request = args.version ? {kind: 'registry', version: args.version} : args.path ? {kind: 'path', path: args.path} : {kind: 'git', git: args.git, rev: required(args, 'rev')};
      return client.request('environment.request', {repository: await scopedRepository(), name: required(args, 'package'), request, wait: true}, Number(args['wait-seconds'] || 1800) * 1000);
    }
    case 'package-install': return client.request('environment.install', {repository: await scopedRepository(), wait: true}, Number(args['wait-seconds'] || 1800) * 1000);
    case 'package-update': return client.request('environment.resolve', {repository: await scopedRepository(), wait: true}, Number(args['wait-seconds'] || 1800) * 1000);
    case 'package-remove': return client.request('environment.remove', {repository: await scopedRepository(), name: required(args, 'package'), wait: true}, Number(args['wait-seconds'] || 1800) * 1000);
    default: throw new SkillError('unknown_operation', `Unknown operation ${operation}; use help.`);
  }
}
