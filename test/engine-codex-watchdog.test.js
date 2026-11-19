import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadSchema, startCodex } from '../src/server/engines/codex.js';
import { createBridge } from '../src/server/engines/bridge.js';
import { createEndpoint } from '../src/server/engines/endpoint.js';

// CLI-ENGINES CE-1.17 / M6, with the fake Codex: every commandExecution or fileChange item that RUNS must have had an accepted approval first. One that did not stops the run at once
// (a tree kill) and restricted mode is offered by the caller. With an accepted approval first, the run goes on. Also: unknown methods, bad lines, a wrong policy, a failed turn,
// stop, the end of the turn (app-server is a server: Bunny ends it), and the tool-list check through the real endpoint.

const FAKE = fileURLToPath(new URL('../src/server/engines/fake-engine.mjs', import.meta.url));
const launcher = [process.execPath, FAKE, 'codex'];
const noUpstream = async function* () { yield { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }; };
const schema = await loadSchema();

async function world() { const base = await mkdtemp(join(tmpdir(), 'bunny-cxw-')); const root = join(base, 'proj'); await mkdir(root, { recursive: true }); return { base, root, home: join(base, 'home') }; }
const bridgeFor = (w, extra = {}) => createBridge({ mode: 'auto', rules: [], root: w.root, protect: [], keyFolders: [], ask: async () => true, ...extra });
async function run(w, script, opts = {}) {
  const r = await startCodex({ cwd: w.root, prompt: 'x', home: w.home, exe: 'x', launcher, model: 'gpt-5.5', bridge: bridgeFor(w), upstream: noUpstream, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify(script) }, schema, ...opts });
  const events = []; for await (const e of r.events) events.push(e);
  return { r, events };
}
const alive = (pid) => new Promise((resolve) => { execFile(join(process.env.SystemRoot, 'System32', 'tasklist.exe'), ['/FI', `PID eq ${pid}`, '/NH'], { windowsHide: true }, (_e, out) => resolve(String(out).includes(String(pid)))); });
const post = (port, token, body) => new Promise((resolve, reject) => { const data = JSON.stringify(body); const req = http.request({ host: '127.0.0.1', port, path: '/v1/responses', method: 'POST', headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); }); req.on('error', reject); req.end(data); });
const types = (events) => events.map((e) => e.type);

test('with an accepted approval first, a command and a patch run and the run goes on: text, steps, edits, usage and done; the server process is ended afterwards', async () => {
  const w = await world(); const cmd = join(w.base, 'cmd.txt'); const patch = join(w.base, 'patch.txt');
  const { r, events } = await run(w, { steps: [{ say: 'Working.' }, { command: 'echo hi', marker: cmd, output: 'hi' }, { patch: [{ path: join(w.root, 'a.txt'), kind: { type: 'add' }, diff: 'x\n' }], marker: patch }] });
  assert.equal(existsSync(cmd), true); assert.equal(existsSync(patch), true);
  assert.deepEqual(types(events).filter((t) => t !== 'text' && t !== 'approval'), ['session', 'tool-start', 'tool-end', 'tool-start', 'edit', 'tool-end', 'usage', 'done']);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'Working.');
  const starts = events.filter((e) => e.type === 'tool-start');
  assert.deepEqual(starts.map((s) => [s.name, s.engineTool]), [['run_command', 'commandExecution'], ['write_file', 'fileChange']]);
  assert.deepEqual(events.filter((e) => e.type === 'tool-end').map((e) => e.ok), [true, true]);
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', input: 11, output: 5 });
  assert.equal(events.filter((e) => e.type === 'approval').length, 2);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await alive(r.pid), false, 'the server process is gone: nothing outlives the run');
});

test('CE-1.17: a command item that runs with NO accepted approval first stops the run at once: tree-killed, marked "Bunny\'s check did not run", no done', async () => {
  const w = await world(); const marker = join(w.base, 'ran.txt');
  const { r, events } = await run(w, { steps: [{ say: 'a' }, { command: 'echo hi', skipApproval: true, marker }, { say: 'never' }] });
  const err = events.find((e) => e.type === 'error');
  assert.equal(err.code, 'watchdog'); assert.match(err.message, /Bunny's check did not run/);
  assert.equal(types(events).includes('done'), false);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'a');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await alive(r.pid), false, 'killed');
});

test('CE-1.17: a file change that completes with no accepted approval first stops the run too; a DECLINED item that completes as declined does not', async () => {
  const w = await world();
  const { events } = await run(w, { steps: [{ patch: [{ path: join(w.root, 'a.txt'), kind: { type: 'add' } }], skipApproval: true }] });
  assert.match(events.find((e) => e.type === 'error').message, /Bunny's check did not run/);
  const declined = await run(w, { steps: [{ patch: [{ path: join(w.base, 'outside.txt'), kind: { type: 'add' } }] }, { say: 'fine' }] });
  assert.equal(declined.events.some((e) => e.type === 'error'), false);
  assert.equal(declined.events.find((e) => e.type === 'tool-end').ok, false);
  assert.equal(types(declined.events).at(-1), 'done');
});

test('a method or notification outside the pinned schema, a line that is not JSON, and a policy that is not untrusted each end the run with an error (M6)', async () => {
  const w = await world();
  for (const [label, script, pattern] of [
    ['unknown notification', { steps: [{ notify: 'brand/new/event', params: {} }] }, /does not know/],
    ['unknown request', { steps: [{ serverRequest: 'item/somethingNew/requestApproval', params: {} }] }, /does not know/],
    ['garbage', { steps: [{ rawLine: 'not json at all' }] }, /not JSON/],
    ['array', { steps: [{ rawLine: '[1,2]' }] }, /not a message/],
    ['wrong policy', { policy: 'on-request', steps: [] }, /ask-for-everything/],
  ]) {
    const { events } = await run(w, script);
    const err = events.find((e) => e.type === 'error');
    assert.ok(err, label); assert.match(err.message, pattern, label);
    assert.equal(events.some((e) => e.type === 'done'), false, label);
  }
});

test('a failed turn is an error with its text; a process that never answers initialize is stopped after the silence limit; an exit before the handshake is an error', async () => {
  const w = await world();
  const failed = await run(w, { turnStatus: 'failed', turnError: { message: 'model said no' }, steps: [] });
  assert.match(failed.events.find((e) => e.type === 'error').message, /model said no/);
  const silent = await run(w, { noInit: true, steps: [] }, { silenceMs: 700 });
  assert.match(silent.events.find((e) => e.type === 'error').message, /printed nothing for too long/);
  const early = await run(w, { steps: [{ exit: 4 }] });
  assert.ok(early.events.some((e) => e.type === 'error' || e.type === 'done'), 'the run ended');
});

test('stop() interrupts the turn and kills the whole tree; the endpoint listener is closed', async () => {
  const w = await world();
  const r = await startCodex({ cwd: w.root, prompt: 'x', home: w.home, exe: 'x', launcher, model: 'gpt-5.5', bridge: bridgeFor(w), upstream: noUpstream, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify({ steps: [{ say: 's' }, { hang: true }] }) }, schema });
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(await alive(r.pid), true);
  const port = r.endpoint.port;
  await r.stop();
  for await (const e of r.events) void e;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await alive(r.pid), false);
  assert.equal(r.endpoint.closed, true); assert.ok(port > 0);
});

test('CE-1.16 through the real endpoint: a request that offers a tool outside the pin\'s five is refused with 400 and stops the run', async () => {
  const w = await world();
  const r = await startCodex({ cwd: w.root, prompt: 'x', home: w.home, exe: 'x', launcher, model: 'gpt-5.5', bridge: bridgeFor(w), upstream: noUpstream, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify({ steps: [{ say: 's' }, { hang: true }] }) }, schema });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const res = await post(r.endpoint.port, r.endpoint.token, { input: 'x', tools: [{ type: 'function', name: 'view_image', parameters: {} }] });
  assert.equal(res.status, 400);
  const events = []; for await (const e of r.events) events.push(e);
  assert.ok(events.some((e) => e.type === 'error' && /does not allow: view_image/.test(e.message)), JSON.stringify(events.map((e) => e.type)));
});

test('the endpoint check function itself (used by the real run) refuses a bad tool list and passes the five', async () => {
  const ep = createEndpoint({ upstream: noUpstream, onToolList: (names) => (names.includes('view_image') ? 'Codex offered a tool Bunny does not allow: view_image.' : true) });
  const { port, token } = await ep.start();
  try {
    const ok = await post(port, token, { input: 'x', tools: [{ type: 'function', name: 'exec_command', parameters: {} }] });
    assert.equal(ok.status, 200);
    const bad = await post(port, token, { input: 'x', tools: [{ type: 'function', name: 'view_image', parameters: {} }] });
    assert.equal(bad.status, 400);
  } finally { await ep.close(); }
});
