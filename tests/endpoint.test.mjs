import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('a Core retired before connection is re-resolved without replaying an RPC', {skip:!process.env.SUBLANG_TEST_RUNTIME,timeout:120000}, async () => {
  const runtime=resolve(process.env.SUBLANG_TEST_RUNTIME);
  const root=mkdtempSync(join(tmpdir(),'sublang retire 中文 '));
  const user=join(root,'user'),home=join(root,'spex'),project=join(root,'project');
  mkdirSync(user);mkdirSync(project);execFileSync('git',['init','-q',project]);
  const env={...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
  for(const k of ['SPEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])delete env[k];
  const request=join(root,'retire-request'),done=join(root,'retired');
  let c,timer,retirement;
  try {
    c=await connect({runtime,home,coreOptions:{home:user,env,watchConfig:false,agentSignIn:async()=>({state:'signed-out'})}});
    const loader=join(root,'retire-before-handshake.mjs');
    // Hold the first handshake until the real original Core has stopped.
    // The original owner process stays alive, as during CLI cleanup.
    writeFileSync(loader,`import{existsSync,writeFileSync}from'node:fs';
const RealWebSocket=globalThis.WebSocket;let first=true;
globalThis.WebSocket=class extends EventTarget{
 constructor(url){super();if(!first)return new RealWebSocket(url);first=false;writeFileSync(${JSON.stringify(request)},'retire');this.timer=setInterval(()=>{if(existsSync(${JSON.stringify(done)})){clearInterval(this.timer);this.dispatchEvent(new Event('error'));}},5);}
 close(){clearInterval(this.timer);}
 send(){throw new Error('no RPC may reach the retired connection');}
};\n`);
    timer=setInterval(()=>{
      if(existsSync(request)&&!retirement)retirement=(async()=>{
        await c.close();c=null;writeFileSync(done,'retired');
      })();
    },5);
    const result=await promisify(execFile)(process.execPath,['--import',pathToFileURL(loader).href,join(runtime,'scripts/sublang.mjs'),'catalog','--project',project,'--spex-home',home,'--host-agent','codex','--wait-seconds','30'],{env,timeout:60000,maxBuffer:8*1024*1024});
    await retirement;
    assert.equal(JSON.parse(result.stdout).ok,true,result.stdout);
    const events=result.stderr.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    assert.ok(events.some(x=>x.event==='core_retry'&&x.reason==='endpoint_retired_before_handshake'));
    assert.ok(events.some(x=>x.event==='core'&&x.mode==='temporary'));
    assert.equal(c,null,'the original Core stopped normally before its replacement');
  }finally{
    clearInterval(timer);await retirement;
    if(c)await c.close();rmSync(root,{recursive:true,force:true});
  }
});

test('concurrent CLI starts wait for the exclusive writer to publish its endpoint', {skip:!process.env.SUBLANG_TEST_RUNTIME,timeout:120000}, async () => {
  const runtime=resolve(process.env.SUBLANG_TEST_RUNTIME);
  const root=mkdtempSync(join(tmpdir(),'sublang concurrent 中文 '));
  const user=join(root,'user'),project=join(root,'project');
  mkdirSync(user);mkdirSync(project);execFileSync('git',['init','-q',project]);
  const env={...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
  for(const k of ['SPEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])delete env[k];
  const invoke=(op='catalog')=>promisify(execFile)(process.execPath,[join(runtime,'scripts/sublang.mjs'),op,'--project',project,'--host-agent','codex','--wait-seconds','60'],{env,timeout:90000,maxBuffer:8*1024*1024});
  try {
    // Initialization is already ready in the real package-check failure;
    // exercise concurrent Core connection lifetimes, not initializer locks.
    await invoke('preflight');
    const results=await Promise.allSettled([invoke(),invoke(),invoke()]);
    for(const r of results){assert.equal(r.status,'fulfilled',r.reason?.stdout||r.reason?.message);assert.equal(JSON.parse(r.value.stdout).ok,true);}
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('a temporary owner stays alive until a borrowing local client finishes', {skip:!process.env.SUBLANG_TEST_RUNTIME,timeout:120000}, async () => {
  const runtime=resolve(process.env.SUBLANG_TEST_RUNTIME);
  const root=mkdtempSync(join(tmpdir(),'sublang borrower 中文 ')),user=join(root,'user'),home=join(root,'spex');
  mkdirSync(user);
  const env={...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
  for(const k of ['SPEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])delete env[k];
  let owner,borrower,closing;
  try {
    owner=await connect({runtime,home,coreOptions:{home:user,env,watchConfig:false,agentSignIn:async()=>({state:'signed-out'})}});
    borrower=await connect({runtime,home});
    assert.equal(owner.owned,true);assert.equal(borrower.owned,false);
    let stopped=false;closing=owner.close().then(()=>{stopped=true;});
    await new Promise(done=>setTimeout(done,100));
    assert.equal(stopped,false,'an attached borrower still owns its operation lifetime');
    assert.ok((await borrower.client.request('config.get')).summary.captain);
    assert.deepEqual(await borrower.client.request('session.list'),[]);
    await borrower.close();borrower=null;await closing;
    assert.equal(existsSync(join(home,'local/agent-endpoint.json')),false);
  }finally{
    if(borrower)await borrower.close();
    if(closing)await closing;else if(owner)await owner.close();
    rmSync(root,{recursive:true,force:true});
  }
});
