import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

test('native Windows retries transient lease inspection and retains persistent refusal', {skip:process.platform!=='win32'||!process.env.SUBLANG_TEST_RUNTIME,timeout:180000}, async t=>{
  for(const persistent of [false,true])await t.test(persistent?'persistent':'transient',async()=>{
    const runtime=resolve(process.env.SUBLANG_TEST_RUNTIME),root=mkdtempSync(join(tmpdir(),'sublang lease 中文 '));
    const user=join(root,'user'),project=join(root,'project');mkdirSync(user);mkdirSync(project);execFileSync('git',['init','-q',project]);
    const counter=join(root,'fault-count'),loader=join(root,'lease-inspection.mjs');
    writeFileSync(loader,`import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
const original=fs.lstatSync;let count=0;
fs.lstatSync=function(file,...args){if(String(file).replaceAll(String.fromCharCode(92),'/').endsWith('/.lease')&&(${persistent}||count===0)){fs.writeFileSync(${JSON.stringify(counter)},String(++count));throw Object.assign(new Error('injected lease sharing violation'),{code:'EPERM'});}return original.call(this,file,...args);};syncBuiltinESMExports();\n`);
    const env={...process.env,HOME:user,USERPROFILE:user,CODEX_HOME:join(user,'.codex'),CLAUDE_CONFIG_DIR:join(user,'.claude')};
    for(const k of ['SPEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_CONTENT','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])delete env[k];
    try{
      const invoke=()=>promisify(execFile)(process.execPath,['--import',pathToFileURL(loader).href,join(runtime,'scripts/sublang.mjs'),'catalog','--project',project,'--host-agent','codex','--wait-seconds','60'],{env,timeout:90000,maxBuffer:8*1024*1024});
      if(persistent){
        await assert.rejects(invoke(),e=>{const d=JSON.parse(e.stdout);assert.equal(d.ok,false);assert.equal(d.error.code,'core_start_failed');assert.match(d.error.message,/EPERM/);return true;});
        assert.equal(existsSync(join(user,'.spex/local/skill-agent.json')),false);
        assert.ok(Number(readFileSync(counter,'utf8'))>1);
      }else{
        assert.equal(JSON.parse((await invoke()).stdout).ok,true);
        assert.equal(Number(readFileSync(counter,'utf8')),1);
      }
      assert.equal(existsSync(join(user,'.spex/local/agent-endpoint.json')),false);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
