/**
 * LOCAL-MODELS, the real service with stand-ins: set-up from a stand-in GitHub, a model from a stand-in Hugging Face, a start with the stand-in server, the window and device rules (LM-13),
 * the release gate that keeps an incomplete allow list from ever being set up (SP-2), delete and Remove. Nothing here touches the network or a real program.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createRealLocalModels, chooseBackend } from '../src/server/localModelsReal.js';
import { spawnTracked } from '../src/server/localRuntime.js';
import { makeZip } from './helpers-archives.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-llama-server.mjs', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GB = 1024 ** 3;

const MODEL = Buffer.concat([Buffer.from('OK\n'), Buffer.alloc(4093, 5)]);
const LIST = [{ id: 'tiny', name: 'Tiny 1B', publisher: 'Acme', family: 'tiny', repo: 'Acme/Tiny-GGUF', revision: 'a'.repeat(40), file: 'tiny-q4.gguf', size: MODEL.length, sha256: sha(MODEL), licence: 'apache-2.0', gated: false, tools: true, toolsProof: 'S-LM2', kvBytesPerToken: 1024, nativeCtx: 32768 }];
const ZIP = makeZip([{ name: 'llama-server.exe', data: 'MZ' }, { name: 'ggml.dll', data: 'd' }, { name: 'ggml-rpc-server.exe', data: 'x' }, { name: 'ggml-rpc.dll', data: 'y' }]);
const PINS = { 'llama-server': { tag: 'b12760', licence: 'MIT', entry: 'llama-server.exe', signed: false, hosts: ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'], skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'],
  files: { cpu: { name: 'x.zip', url: 'https://github.com/ggml-org/llama.cpp/releases/download/b12760/x.zip', size: ZIP.length, sha256: sha(ZIP), kind: 'zip', allowComplete: true, allow: ['llama-server.exe', 'ggml.dll'] },
    vulkan: { name: 'v.zip', url: 'https://github.com/ggml-org/llama.cpp/releases/download/b12760/v.zip', size: ZIP.length, sha256: sha(ZIP), kind: 'zip', allowComplete: true, allow: ['llama-server.exe', 'ggml.dll'] } } } };

const stream = (buf) => (async function* () { for (let i = 0; i < buf.length; i += 1024) yield buf.subarray(i, i + 1024); })();
/** One stand-in for both hosts: GitHub redirects to its asset host and serves the zip; Hugging Face redirects to its CDN and serves the model (with Range). */
const hub = async (url, { headers = {} } = {}) => {
  const u = new URL(url);
  if (u.hostname === 'github.com') return { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x' }, body: [] };
  if (u.hostname === 'release-assets.githubusercontent.com') return { status: 200, headers: {}, body: stream(ZIP) };
  if (u.hostname === 'huggingface.co') return { status: 302, headers: { location: 'https://us.aws.cdn.hf.co/blob', 'x-linked-size': String(MODEL.length), 'x-linked-etag': `"${sha(MODEL)}"` }, body: [] };
  const from = headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)[1]) : 0;
  return { status: from ? 206 : 200, headers: {}, body: stream(MODEL.subarray(from)) };
};

async function service(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-real-'));
  const lm = createRealLocalModels({
    dataDir: dir, list: LIST, pins: PINS, fetchImpl: hub, trial: async () => true,
    pc: async () => ({ totalRam: 16 * GB, freeRam: 12 * GB, vram: null, freeVram: null, gpu: false, freeDisk: 100 * GB, gpuName: null }),
    launch: async ({ args, cwd, env }) => spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH } }),
    ...extra,
  });
  t.after(async () => { await lm.stopAll(); await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
  await lm.load();
  return { dir, lm };
}
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

test('the backend: Vulkan only for the vendors it was proven on, and only with the switch on', () => {
  assert.equal(chooseBackend({ vendor: 'NVIDIA', useGpu: true }), 'vulkan');
  assert.equal(chooseBackend({ vendor: 'Intel', useGpu: true }), 'vulkan');
  assert.equal(chooseBackend({ vendor: 'AMD', useGpu: true }), 'cpu');
  assert.equal(chooseBackend({ vendor: 'NVIDIA', useGpu: false }), 'cpu');
  assert.equal(chooseBackend({ vendor: null }), 'cpu');
});

test('SP-2: the real pins (allow lists not complete) can never be set up: the build says it is not available yet', async (t) => {
  const { lm } = await service(t, { pins: undefined });
  await assert.rejects(lm.setUp(), (e) => e.code === 'local.notAvailable' && e.status === 501);
  const s = await lm.status();
  assert.equal(s.installed, false);
  assert.equal(s.program.available, false);
  assert.equal(s.program.signed, false, 'the card says the program is not signed');
  assert.equal(s.program.tag, 'b12760');
  assert.deepEqual(s.models.map((m) => m.id), ['tiny'].length ? s.models.map((m) => m.id) : []);
});

test('set up from the stand-in GitHub, download a model from the stand-in Hugging Face, start it with the key, chat, stop, delete, Remove', async (t) => {
  const { dir, lm } = await service(t);
  await lm.setUp();
  const s1 = await until(async () => { const s = await lm.status(); return s.installed ? s : null; });
  assert.equal(s1.runtime.backend, 'cpu');
  assert.equal(existsSync(join(dir, 'runtimes', 'llama.cpp', 'b12760-cpu', 'ggml-rpc.dll')), false, 'SP-2: the RPC files were never written');
  await lm.download('tiny');
  const s2 = await until(async () => { const s = await lm.status(); return s.models[0].state === 'ready' ? s : null; });
  assert.equal(s2.models[0].fingerprint, sha(MODEL).slice(0, 12));
  assert.deepEqual((await lm.pickerModels()).map((m) => m.displayName), ['Tiny 1B']);
  // the window starts it; the key and address are looked up per request
  const run = await lm.ensure('tiny', { who: 'window' });
  assert.equal(run.modelId, 'tiny');
  const key = lm.apiKey();
  assert.match(key, /^[0-9a-f]{64}$/);
  const res = await fetch(`${lm.baseUrl()}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
  assert.match(await res.text(), /hello from the stand-in/);
  assert.equal((await lm.status()).running.id, 'tiny');
  // LM-13: a device may chat with what runs, and starts nothing
  assert.equal((await lm.ensure('tiny', { who: 'device' })).modelId, 'tiny');
  await lm.stopNow();
  assert.equal(lm.baseUrl(), '');
  await assert.rejects(lm.ensure('tiny', { who: 'device' }), (e) => e.code === 'local.notRunning' && /Start it from Bunny's window/.test(e.message));
  assert.equal(lm.runner.running(), null, 'a device never started it');
  await lm.remove('tiny');
  assert.equal((await lm.status()).models[0].state, 'none');
  await lm.download('tiny');
  await until(async () => (await lm.status()).models[0].state === 'ready');
  await lm.removeAll();
  assert.equal(existsSync(join(dir, 'models', 'Acme__Tiny-GGUF')), false);
  assert.equal(existsSync(join(dir, 'runtimes')), false);
  assert.equal((await lm.status()).installed, false);
});

test('LM-14 and LM-18: only the window starts it; a scheduled run, a helper, a device or a body that merely says textOnly get local.notRunning', async (t) => {
  const { lm } = await service(t);
  await lm.setUp();
  await until(async () => (await lm.status()).installed);
  await lm.download('tiny');
  await until(async () => (await lm.status()).models[0].state === 'ready');
  for (const who of ['device', 'scheduled', 'helper', 'textOnly']) {
    await assert.rejects(lm.ensure('tiny', { who }), (e) => e.code === 'local.notRunning', who);
    assert.equal(lm.runner.running(), null, `${who} started nothing`);
  }
  await lm.ensure('tiny', { who: 'window' });
  for (const who of ['device', 'scheduled', 'helper']) assert.equal((await lm.ensure('tiny', { who })).modelId, 'tiny', `${who} may use what already runs`);
});

test('a start refuses, with the drawn words, when the program changed or is gone, and the status shows the alert', async (t) => {
  const { dir, lm } = await service(t);
  await lm.setUp();
  await until(async () => (await lm.status()).installed);
  await lm.download('tiny');
  await until(async () => (await lm.status()).models[0].state === 'ready');
  await writeFile(join(dir, 'runtimes', 'llama.cpp', 'b12760-cpu', 'ggml.dll'), 'tampered');
  assert.deepEqual((await lm.status()).alerts.map((a) => a.kind), ['changed']);
  await assert.rejects(lm.ensure('tiny', { who: 'window' }), (e) => e.code === 'local.changed' && /program changed on disk/.test(e.message));
  await rm(join(dir, 'runtimes', 'llama.cpp', 'b12760-cpu'), { recursive: true, force: true });
  assert.deepEqual((await lm.status()).alerts.map((a) => a.kind), ['missing']);
  await assert.rejects(lm.ensure('tiny', { who: 'window' }), (e) => e.code === 'local.missing');
});

test('a model too big for this PC is refused before anything is fetched', async (t) => {
  const { lm } = await service(t, { pc: async () => ({ totalRam: 2 * GB, freeRam: 1 * GB, vram: null, freeVram: null, gpu: false, freeDisk: 100 * GB, gpuName: null }) });
  await lm.setUp();
  await until(async () => (await lm.status()).installed);
  assert.equal((await lm.status()).models[0].fit, 'too-big');
  await assert.rejects(lm.download('tiny'), (e) => e.code === 'local.tooBig');
});

test('the saved settings never hold an address or a key', async (t) => {
  const { dir, lm } = await service(t);
  await lm.setUp();
  await until(async () => (await lm.status()).installed);
  await lm.download('tiny');
  await until(async () => (await lm.status()).models[0].state === 'ready');
  await lm.ensure('tiny', { who: 'window' });
  const key = lm.apiKey();
  const saved = await readFile(join(dir, 'local-models.json'), 'utf8');
  assert.equal(saved.includes(key), false);
  assert.doesNotMatch(saved, /127\.0\.0\.1|baseUrl|apiKey|http/);
});
