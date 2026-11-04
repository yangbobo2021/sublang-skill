import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { absolutePath, prependPath } from './platform.mjs';

export class SkillError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

export function endpoint(home, protocolVersion) {
  const file = join(home, 'local', 'agent-endpoint.json');
  let stat;
  try { stat = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) {
    throw new SkillError('unsafe_endpoint', 'SPEX local endpoint must be a private regular file owned by this user.');
  }
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new SkillError('invalid_endpoint', 'SPEX local endpoint is malformed; no lease or endpoint was removed.'); }
  if (data.format !== 1 || !Number.isSafeInteger(data.pid) || data.pid <= 0 || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || typeof data.token !== 'string' || data.token.length < 1) {
    throw new SkillError('invalid_endpoint', 'SPEX local endpoint has invalid fields.');
  }
  try { process.kill(data.pid, 0); } catch (error) { if (error.code === 'ESRCH') return null; throw new SkillError('endpoint_unverifiable', 'Cannot verify the SPEX endpoint owner.'); }
  if (data.protocolVersion !== protocolVersion) throw new SkillError('protocol_mismatch', `SPEX protocol ${data.protocolVersion} differs from this Skill's ${protocolVersion}; use matching releases or close the older App.`);
  return data;
}

export class Client {
  constructor(socket, protocolVersion, emit = () => {}) {
    this.socket = socket; this.protocolVersion = protocolVersion; this.emit = emit;
    this.pending = new Map(); this.messages = []; this.sequence = 0;
    this.closed = false;
    this.hello = new Promise((yes, no) => { this.helloYes = yes; this.helloNo = no; });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'hello') {
        if (message.protocolVersion !== protocolVersion) this.helloNo(new SkillError('protocol_mismatch', 'SPEX protocol mismatch; no command was sent.'));
        else this.helloYes();
      }
      if (message.type === 'reply') {
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.ok ? pending.yes(message.result) : pending.no(new SkillError(message.error.code, message.error.message, message.error.details)); }
      }
      this.messages.push(message);
      if (this.messages.length > 4000) this.messages.splice(0, this.messages.length - 4000);
      if (message.type === 'approval.state' && message.state?.pending?.length) this.emit({event: 'native_approval', state: message.state});
      if (message.type === 'compile.progress' || message.type === 'draft.compile.progress') this.emit({event: message.type, ...message});
    });
    socket.addEventListener('error', () => this.fail(new SkillError('connection_failed', 'Cannot connect to the existing SPEX core; no second writer was started.')));
    socket.addEventListener('close', () => this.fail(new SkillError('connection_closed', 'SPEX connection closed; inspect retained task state before retrying.')));
  }
  fail(error) {
    this.closed = true; this.helloNo(error);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.no(error); } this.pending.clear();
  }
  async ready() {
    let timer;
    try { await Promise.race([this.hello, new Promise((_, no) => { timer = setTimeout(() => no(new SkillError('connection_timeout', 'SPEX did not answer its protocol handshake.')), 10000); })]); }
    finally { clearTimeout(timer); }
  }
  request(type, fields = {}, timeoutMs = 120000) {
    if (this.closed) return Promise.reject(new SkillError('connection_closed', 'SPEX connection is closed.'));
    const id = `skill-${process.pid}-${++this.sequence}`;
    return new Promise((yes, no) => {
      const timer = setTimeout(() => { this.pending.delete(id); no(new SkillError('request_timeout', `${type} timed out; inspect actual state before retrying.`, {operation: type})); }, timeoutMs);
      this.pending.set(id, {yes, no, timer});
      try { this.socket.send(JSON.stringify({...fields, type, id})); } catch (error) { clearTimeout(timer); this.pending.delete(id); no(error); }
    });
  }
  close() { this.socket.close(); }
}

export async function connect({runtime, home = process.env.SPEX_HOME || join(homedir(), '.spex'), emit, coreOptions = {}}) {
  home = resolve(home);
  const release = JSON.parse(readFileSync(join(runtime, 'release.json'), 'utf8'));
  let service;
  let address = endpoint(home, release.protocolVersion);
  if (!address) {
    const require = createRequire(join(runtime, 'package.json'));
    const {CoreService} = await import(pathToFileURL(require.resolve('@sublang/spex-core')).href);
    try {
      service = await CoreService.start({dataDir: home,
        env: prependPath(process.env, join(runtime, 'node_modules', '.bin')),
        compileRuntime: {execPath: process.execPath, electron: false, modulePaths: [join(runtime, 'node_modules')]}, ...coreOptions});
    } catch (error) {
      // A concurrently starting client may have acquired the one root lease.
      address = endpoint(home, release.protocolVersion);
      if (!address) throw new SkillError(error.name === 'StateRootHeldError' ? 'core_busy' : 'core_start_failed', error.message + (error.name === 'StateRootHeldError' ? ' Close the older App if it does not expose a local endpoint; never remove its lease.' : ''));
    }
    if (service) address = {port: service.port(), token: service.token()};
  }
  const client = new Client(new WebSocket(`ws://127.0.0.1:${address.port}/?token=${encodeURIComponent(address.token)}`), release.protocolVersion, emit);
  try { await client.ready(); } catch (error) { client.close(); if (service) await service.stop(); throw error; }
  return {client, home, owned: !!service, async close() { client.close(); if (service) await service.stop(); }};
}

export function projectPath(path) {
  if (!absolutePath(path)) throw new SkillError('project_required', '--project must name an absolute existing project root.');
  return realpathSync(path);
}
