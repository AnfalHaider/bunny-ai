/**
 * LOCAL-MODELS (QA's blocker at ec6358a6): the first message to a STOPPED Bunny local model must get words. The address of the model is looked up per request and is '' while it is stopped;
 * the chat route read the provider before it started the model, so the stream went to ''. Fake mode hid this, so this test runs the real service, the real runtime and the real chat route
 * (fake:false) with a stand-in llama-server: a cold start, an explicit stop, and a switch to another model, each followed by a first message.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';
import { createRealLocalModels } from '../src/server/localModelsReal.js';
import { createFolderRules } from '../src/server/localFolderRules.js';
import { createPlaces } from '../src/server/localPlaces.js';
import { createStore } from '../src/server/localStore.js';
import { spawnTracked } from '../src/server/localRuntime.js';
import { makeZip } from './helpers-archives.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-llama-server.mjs', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GB = 1024 ** 3;
const bytes = (tag) => Buffer.concat([Buffer.from('OK\n'), Buffer.alloc(3000, tag)]);
const A = bytes(5); const B = bytes(6);
const entry = (id, name, b, file) => ({ id, name, publisher: 'Acme', family: 'tiny', repo: `Acme/${name.replace(/ /g, '-')}-GGUF`, revision: 'a'.repeat(40), file, size: b.length, sha256: sha(b), licence: 'apache-2.0', gated: false, tools: false, kvBytesPerToken: 1024, nativeCtx: 8192 });
const LIST = [entry('tiny', 'Tiny 1B', A, 'tiny-q4.gguf'), entry('small', 'Small 2B', B, 'small-q4.gguf')];
const ZIP = makeZip([{ name: 'llama-server.exe', data: 'MZ' }, { name: 'ggml.dll', data: 'd' }]);
const PINS = { 'llama-server': { tag: 'b12760', licence: 'MIT', entry: 'llama-server.exe', signed: false, hosts: ['github.com', 'release-assets.githubusercontent.com'], skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'],
  files: { cpu: { name: 'x.zip', url: 'https://github.com/ggml-org/llama.cpp/releases/download/b12760/x.zip', size: ZIP.length, sha256: sha(ZIP), kind: 'zip', allowComplete: true, allow: ['llama-server.exe', 'ggml.dll'] } } } };
const stream = (buf) => (async function* () { for (let i = 0; i < buf.length; i += 1024) yield buf.subarray(i, i + 1024); })();
const hub = async (url, { headers = {} } = {}) => {
  const u = new URL(url);
  if (u.hostname === 'github.com') return { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x' }, body: [] };
  if (u.hostname === 'release-assets.githubusercontent.com') return { status: 200, headers: {}, body: stream(ZIP) };
  if (u.hostname === 'huggingface.co') {
    const m = LIST.find((e) => u.pathname.includes(e.repo)); const b = m.id === 'tiny' ? A : B;
    return { status: 302, headers: { location: `https://us.aws.cdn.hf.co/${m.id}`, 'x-linked-size': String(b.length), 'x-linked-etag': `"${sha(b)}"` }, body: [] };
  }
  const cdn = LIST.find((e) => u.pathname.includes(e.id)); const body = cdn.id === 'tiny' ? A : B;
  const from = headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)[1]) : 0;
  return { status: from ? 206 : 200, headers: {}, body: stream(body.subarray(from)) };
};
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

async function world(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-fm-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['data', 'home', 'win']) await mkdir(d(p), { recursive: true });
  const rules = createFolderRules({ dataDir: d('data'), home: d('home'), env: { SystemRoot: d('win') }, driveType: async () => 'Fixed', knownFolders: async () => ({}) });
  const places = createPlaces({ dataDir: d('data'), rules, home: d('home') });
  const store = createStore({ dataDir: d('data'), places, rules, lock: async () => true });
  const localModels = createRealLocalModels({
    dataDir: d('data'), list: LIST, pins: PINS, fetchImpl: hub, trial: async () => true, gpuInfo: async () => null, rules, places, store, home: d('home'),
    pc: async () => ({ totalRam: 16 * GB, freeRam: 12 * GB, vram: null, freeVram: null, gpu: false, freeDisk: 100 * GB, gpuName: null }),
    launch: async ({ args, cwd, env }) => spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH } }),
  });
  const { base } = await startApp(t, { dataDir: d('data'), localModels, fake: false });
  t.after(async () => { await localModels.stopAll(); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
  await localModels.setUp(); await until(async () => (await localModels.status()).installed);
  for (const e of LIST) { await localModels.download(e.id); await until(async () => (await localModels.status()).models.find((m) => m.id === e.id).state === 'ready'); }
  await fetch(`${base}/api/local-models`); // the card's own read: Bunny local counts as connected now
  return { base, localModels };
}
async function say(base, model, content) {
  const made = await post(base, '/api/sessions', { title: 'local', providerId: 'bunny-local', model });
  assert.ok(made.status < 300, JSON.stringify(made.body));
  const res = await fetch(`${base}/api/sessions/${made.body.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, mode: 'ask' }) });
  return { status: res.status, text: await res.text() };
}

test('the first message to a stopped model gets words: a cold start, after Stop now, and after a switch to the other model', async (t) => {
  const { base, localModels } = await world(t);
  assert.equal(localModels.runner.running(), null, 'nothing runs yet');
  const cold = await say(base, 'tiny', 'hello');
  assert.doesNotMatch(cold.text, /notRunning|local\.notRunning/);
  assert.match(cold.text, /hello from the stand-in/, 'the cold start answered');
  assert.equal(localModels.runner.running().modelId, 'tiny');
  await localModels.stopNow();
  const afterStop = await say(base, 'tiny', 'hello again');
  assert.match(afterStop.text, /hello from the stand-in/, 'the first message after Stop now answered');
  const other = await say(base, 'small', 'and you?');
  assert.match(other.text, /hello from the stand-in/, 'the first message after a switch answered');
  assert.equal(localModels.runner.running().modelId, 'small');
});
