import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { connect } from '../scripts/client.mjs';

test('signal-denied clients authenticate to the existing Core; rejected tokens never start another writer', {skip:!process.env.SUBLANG_TEST_RUNTIME,timeout:120000}, async () => {
  const runtime=resolve(process.env.SUBLANG_TEST_RUNTIME);
  const root=mkdtempSync(join(tmpdir(),'sublang attach 中文 '));
  const user=join(root,'user'),home=join(root,'spex'),project=join(root,'project');
  mkdirSync(user);mkdirSync(project);execFileSync('git',['init','-q',project]);
  const env={...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
  for(const k of ['SPEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])delete env[k];
  let c;
  try {
    c=await connect({runtime,home,coreOptions:{home:user,env,watchConfig:false,agentSignIn:async()=>({state:'signed-out'})}});
    assert.equal(c.owned,true);
    const endpoint=join(home,'local/agent-endpoint.json'),before=readFileSync(endpoint);
    const loader=join(root,'signal-denied.mjs');
    writeFileSync(loader,`const kill=process.kill.bind(process);
process.kill=(pid,signal)=>{if(signal===0)throw Object.assign(new Error('signal denied by test host'),{code:'EPERM'});return kill(pid,signal);};\n`);
    const invoke=()=>promisify(execFile)(process.execPath,['--import',pathToFileURL(loader).href,join(runtime,'scripts/sublang.mjs'),'catalog','--project',project,'--spex-home',home,'--host-agent','codex','--wait-seconds','30'],{env,timeout:45000,maxBuffer:8*1024*1024});
    const result=await invoke();
    assert.equal(JSON.parse(result.stdout).ok,true,result.stdout);
    assert.ok(result.stderr.split('\n').some(line=>{try{return JSON.parse(line).event==='core'&&JSON.parse(line).mode==='attached';}catch{return false;}}));
    assert.deepEqual(readFileSync(endpoint),before,'attached client must leave the original endpoint intact');
    assert.equal((await c.client.request('config.get')).summary.captain.adapter,'codex');
    assert.deepEqual(await c.client.request('session.list'),[]);
    const invalid=JSON.parse(before);invalid.token='rejected-fixture-token';
    writeFileSync(endpoint,JSON.stringify(invalid));
    try {
      await assert.rejects(invoke(),error=>{
        const failure=JSON.parse(error.stdout);
        assert.equal(failure.ok,false);
        assert.match(failure.error.code,/connection_/);
        assert.equal(failure.error.message.includes(invalid.token),false);
        return true;
      });
      assert.equal(JSON.parse(readFileSync(endpoint,'utf8')).identity,invalid.identity);
      assert.deepEqual(await c.client.request('session.list'),[],'original writer remains responsive');
    }finally{writeFileSync(endpoint,before);}
  }finally{if(c)await c.close();rmSync(root,{recursive:true,force:true});}
});
