import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { absolutePath, containedFile, npmInvocation, prependPath } from '../scripts/platform.mjs';

test('Windows paths and PATH composition retain native drive, UNC and argument boundaries (simulation)', () => {
  for (const path of [String.raw`C:\Users\测试 用户\repo`, 'C:/work/project', String.raw`\\server\share\repo`, String.raw`\\?\C:\work\repo`]) assert.equal(absolutePath(path,'win32'),true,path);
  for (const path of [String.raw`C:relative`, String.raw`\rooted`, '/rooted', 'relative', '']) assert.equal(absolutePath(path,'win32'),false,path);
  const root=String.raw`C:\Users\测试 用户\sublang`;
  assert.equal(containedFile(root,win32.resolve(root,'scripts/setup.mjs'),'win32'),true);
  for (const path of [root,win32.resolve(root,'../outside'),'D:\\other',root+'-other\\file']) assert.equal(containedFile(root,path,'win32'),false,path);
  const original={Path:String.raw`C:\Git\cmd;C:\Windows\System32`,TOKEN:'unchanged'};
  const merged=prependPath(original,String.raw`C:\Users\测试 用户\runtime\node_modules\.bin`,'win32');
  assert.equal(Object.keys(merged).filter(k=>k.toLowerCase()==='path').length,1);
  assert.equal(merged.Path.split(';').length,3);assert.equal(merged.TOKEN,original.TOKEN);assert.deepEqual(Object.keys(original),['Path','TOKEN']);
  assert.deepEqual(prependPath({Path:'ignored',PATH:'selected'},'C:\\node','win32'),{PATH:'C:\\node;selected'});
  const execPath=String.raw`C:\Program Files\nodejs\node.exe`;
  const npmCli=String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`;
  const args=['ci','--prefix',String.raw`C:\Users\测试 用户\cache`];
  assert.deepEqual(npmInvocation(args,{platform:'win32',execPath,env:{},exists:path=>path===npmCli}),{command:execPath,args:[npmCli,...args]});
  assert.throws(()=>npmInvocation(args,{platform:'win32',execPath,env:{},exists:()=>false}),/setup.ps1/);
});

test('native npm entry executes without a shell from a directory containing spaces and Chinese characters', t => {
  const dir=mkdtempSync(join(tmpdir(),'sublang npm 中文 '));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const manifest={name:'portable-local-fixture',version:'1.2.3',private:true};
  writeFileSync(join(dir,'package.json'),JSON.stringify(manifest));
  const command=npmInvocation(['pkg','get','name','version']);
  const output=execFileSync(command.command,command.args,{cwd:dir,encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),{name:manifest.name,version:manifest.version});
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'package.json'),'utf8')),manifest);
});
