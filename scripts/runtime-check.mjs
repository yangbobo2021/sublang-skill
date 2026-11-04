import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SkillError } from './client.mjs';

// Evidence comes from the serving Core, including when we attach to an
// existing writer. Checking only this process's node_modules is insufficient.
export async function runtimeCheck(client, runtime, projectId, selection) {
  const release = JSON.parse(readFileSync(join(runtime,'release.json'),'utf8'));
  const info = await client.request('runtime.info',projectId ? {projectId} : {});
  const issues = [];
  const build = info.core.build;
  if (!build || ['commit','tree','patchSha256','lockSha256'].some(k=>build[k]!==release.source[k])) issues.push({kind:'core_build_mismatch'});
  if (!info.cliBuild || ['commit','tree','patchSha256','lockSha256'].some(k=>info.cliBuild[k]!==release.source[k])) issues.push({kind:'cli_build_mismatch'});
  if (info.builtin?.version !== release.builtinPackage.version) issues.push({kind:'builtin_version_mismatch',actual:info.builtin?.version});
  if (info.packages['@sublang/playbook/xstate-runtime'].version !== release.dependencies['@sublang/playbook']) issues.push({kind:'host_engine_version_mismatch'});
  const workflows = selection ? info.workflows.filter(w=>w.id===selection.name && w.package===selection.package && w.repository===selection.repository) : info.workflows;
  if (selection && !workflows.length) issues.push({kind:'selected_workflow_missing'});
  for (const row of workflows) if (row.present && row.status !== 'aligned') issues.push({kind:'workflow_engine_unverified',id:row.id,package:row.package,module:row.module});
  const result = {...info,issues,aligned:issues.length===0};
  if (selection && issues.length) throw new SkillError('runtime_mismatch','The serving Core or selected workflow does not resolve to this release’s engine; inspect runtime-check before running. No workflow was submitted.',result);
  return result;
}
