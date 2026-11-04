import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('Core survives unavailable native watchers and observes external config edits on macOS and Windows', {skip:!process.env.SUBLANG_TEST_RUNTIME,timeout:120000}, async t => {
  const runtime=resolve(process.env.SUBLANG_TEST_RUNTIME);
  for (const mode of ['throw','error-event']) await t.test(mode,()=>{
    const root=mkdtempSync(join(tmpdir(),'sublang watch 中文 '));
    try {
      const user=join(root,'user'),home=join(root,'spex'),project=join(root,'project');
      mkdirSync(user);mkdirSync(project);execFileSync('git',['init','-q',project]);
      const loader=join(root,'unavailable-watch.mjs'),script=join(root,'probe.mjs');
      writeFileSync(loader,`import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
fs.watch=()=>{
 const error=Object.assign(new Error('native notifications denied by test host'),{code:'EMFILE'});
 if (${JSON.stringify(mode)}==='throw') throw error;
 const w=new EventEmitter();w.close=()=>{};
 queueMicrotask(()=>w.emit('error',error));return w;
};syncBuiltinESMExports();\n`);
      writeFileSync(script,`import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {connect} from ${JSON.stringify(pathToFileURL(join(runtime,'scripts/client.mjs')).href)};
const home=${JSON.stringify(home)}, project=${JSON.stringify(project)},user=${JSON.stringify(user)};
const c=await connect({runtime:${JSON.stringify(runtime)},home,coreOptions:{home:user,env:process.env,agentSignIn:async()=>({state:'signed-out'})}});
try {
 const config=await c.client.request('config.get');
 const before=readFileSync(config.summary.path,'utf8');
 const model=config.summary.captain.model;
 assert.ok(model && before.includes(model));
 const after=before.replace(model,'claude-poll-observed');
 writeFileSync(config.summary.path,after);
 const deadline=Date.now()+8000;
 let observed=false;
 while(Date.now()<deadline){
  const next=await c.client.request('config.get');
  if(next.summary?.captain.model==='claude-poll-observed'){observed=true;break;}
  await new Promise(r=>setTimeout(r,150));
 }
 assert.equal(observed,true,'external config changes must still be observed');
 await c.client.request('project.register',{path:project});
 assert.equal((await c.client.request('project.list')).length,1);
 assert.deepEqual(await c.client.request('session.list'),[]);
 console.log(JSON.stringify({ok:true,observed,noWorkflowSessions:true}));
}finally{await c.close();}\n`);
      const env={...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
      for(const key of ['SPEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])delete env[key];
      const out=execFileSync(process.execPath,['--import',pathToFileURL(loader).href,script],{env,encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});
      assert.deepEqual(JSON.parse(out),{ok:true,observed:true,noWorkflowSessions:true});
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
