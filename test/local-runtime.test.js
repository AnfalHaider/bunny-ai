/**
 * LOCAL-MODELS runtime start and stop: the exact argv (LM-10), Security's SP-3 (no --lora, no /lora-adapters), SP-5 (the key file is deleted once /health answers), the environment (LM-10),
 * the port registration (LM-17), single flight and the idle stop (LM-9, LM-11). A stand-in node script plays llama-server; no real model or program is involved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { buildArgv, checkArgv, createLocalRuntime, runtimeEnv, plainReason, spawnTracked, leftoverCommand, FORBIDDEN_FLAGS } from '../src/server/localRuntime.js';
import { installFromZip } from '../src/server/localRuntimeInstall.js';
import { isRuntimeAddress, runtimePorts } from '../src/server/ownAddress.js';
import { makeZip } from './helpers-archives.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-llama-server.mjs', import.meta.url));
async function temp(t) { const d = await mkdtemp(join(tmpdir(), 'bunny-lr-')); t.after(() => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })); return d; }

async function setup(t, { modelText = 'OK' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-lr-'));
  let stopper = null;
  t.after(async () => { await stopper?.(); await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }); // the server holds the models folder: stop it first
  const zip = join(dir, 'x.zip');
  await writeFile(zip, makeZip([{ name: 'llama-server.exe', data: 'MZ' }]));
  const pins = { 'llama-server': { tag: 'b12760', entry: 'llama-server.exe', skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'], files: { cpu: { sha256: 'x', allow: ['llama-server.exe'] } } } };
  const runtimeDir = join(dir, 'runtimes', 'llama.cpp', 'b12760-cpu');
  await installFromZip({ zip, dir: runtimeDir, pins, backend: 'cpu' });
  const modelsDir = join(dir, 'models');
  await mkdir(modelsDir, { recursive: true });
  const modelFile = join(modelsDir, 'm.gguf');
  await writeFile(modelFile, modelText);
  const launched = [];
  const launch = async ({ args, cwd, env }) => { launched.push({ args, cwd, env }); return spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH } }); };
  const rt = createLocalRuntime({ dataDir: dir, launch, healthWaitMs: 15000 });
  stopper = () => rt.stop();
  return { dir, rt, runtimeDir, modelFile, launched };
}

test('LM-10: the exact argv, and every forbidden flag is refused (SP-3: --lora and --lora-scaled included)', () => {
  const argv = buildArgv({ model: 'C:\\m\\q.gguf', port: 51234, keyFile: 'C:\\d\\run\\k.key', ctx: 16384, gpu: false });
  assert.deepEqual(argv, ['-m', 'C:\\m\\q.gguf', '--host', '127.0.0.1', '--port', '51234', '--api-key-file', 'C:\\d\\run\\k.key', '--no-ui', '--no-slots', '-c', '16384', '--jinja', '--log-verbosity', '1']);
  assert.deepEqual(buildArgv({ model: 'm', port: 1, keyFile: 'k', ctx: 8192, gpu: true }).slice(-2), ['-ngl', '99']);
  assert.doesNotThrow(() => checkArgv(argv));
  for (const bad of ['--lora', '--lora-scaled', '--metrics', '--props', '-hf', '--hf-repo', '--tools', '--agent', '--ui-agent', '--allow-unauthenticated-tools', '--rpc', '--models-dir', '--api-key']) {
    assert.throws(() => checkArgv([...argv, bad, 'x']), /never uses/, bad);
    assert.throws(() => checkArgv([...argv, `${bad}=x`]), /never uses/, `${bad}=`);
  }
  assert.throws(() => checkArgv(argv.map((a) => (a === '127.0.0.1' ? '0.0.0.0' : a))), /127\.0\.0\.1/);
  assert.throws(() => checkArgv(argv.filter((a) => a !== '--no-slots')), /no --no-slots/);
  for (const f of ['--lora', '--lora-scaled']) assert.ok(FORBIDDEN_FLAGS.includes(f));
});

test('SP-3: Bunny\'s own code never calls /lora-adapters', () => {
  const hits = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(js|mjs|cjs|html)$/.test(n) && /lora-adapters/.test(readFileSync(f, 'utf8'))) hits.push(f); } };
  walk(join(dirname(fileURLToPath(import.meta.url)), '..', 'src'));
  walk(join(dirname(fileURLToPath(import.meta.url)), '..', 'electron'));
  assert.deepEqual(hits, []);
});

test('LM-10: the child\'s environment has none of the listed variables, and has HF_HUB_OFFLINE=1 and LLAMA_CACHE inside the models folder', () => {
  const secret = { OPENAI_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-y', HF_TOKEN: 'hf_x', HUGGING_FACE_HUB_TOKEN: 'hf_y', BUNNY_ADMIN: 'a', BUNNY_DATA_DIR: 'd', HTTPS_PROXY: 'http://u:p@h', HTTP_PROXY: 'http://u:p@h', NODE_OPTIONS: '--require x', GITHUB_TOKEN: 'g', PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows' };
  const env = runtimeEnv({ dataDir: 'C:\\data', base: secret });
  for (const k of Object.keys(secret)) if (!['PATH', 'SystemRoot'].includes(k)) assert.equal(env[k], undefined, k);
  assert.equal(env.HF_HUB_OFFLINE, '1');
  assert.equal(env.LLAMA_CACHE, join('C:\\data', 'models', '.cache'));
  assert.equal(Object.keys(env).filter((k) => /key|token|secret|proxy|bunny|node_options/i.test(k)).length, 0);
});

test('SP-5 and LM-9: a start waits for /health, deletes the key file at once, keeps the key only in memory, and registers the port; Stop unregisters it', async (t) => {
  const { dir, rt, runtimeDir, modelFile, launched } = await setup(t);
  const run = await rt.ensure({ runtimeDir, modelFile, modelId: 'qwen3-4b', ctx: 8192, gpu: false });
  assert.ok(run.port > 0);
  assert.deepEqual(await readdir(join(dir, 'runtimes', 'run')), [], 'the key file is gone after a successful start');
  assert.equal(isRuntimeAddress(`http://127.0.0.1:${run.port}/`), true, 'the port is registered');
  const { baseUrl, apiKey } = rt.endpoint();
  assert.equal(baseUrl, `http://127.0.0.1:${run.port}/v1`);
  assert.match(apiKey, /^[0-9a-f]{64}$/);
  // the key never appears in the argv, the environment, the running record or the file system
  const text = JSON.stringify({ launched, running: rt.running() });
  assert.equal(text.includes(apiKey), false);
  assert.equal(launched[0].args.join(' ').includes(apiKey), false);
  assert.equal(launched[0].cwd, runtimeDir, "LF-7: the working folder is Bunny's runtime folder, never a model's folder");
  // the key opens the server and nothing else does
  assert.equal((await fetch(`${baseUrl}/models`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/models`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } })).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${run.port}/health`)).status, 200, 'only /health is open');
  await rt.stop();
  assert.equal(runtimePorts.has(String(run.port)), false);
  assert.equal(rt.endpoint(), null);
});

test('SP-5: a failed start deletes the key file too, and says why in plain words, never raw stderr', async (t) => {
  for (const [text, code, words] of [['OOM\n', 'local.memory', /not enough memory/i], ['EXIT\n', 'local.exited', /stopped before it was ready/]]) {
    const { dir, rt, runtimeDir, modelFile } = await setup(t, { modelText: text });
    await assert.rejects(rt.ensure({ runtimeDir, modelFile, modelId: 'x', ctx: 8192, gpu: false }), (e) => e.code === code && words.test(e.message) && !/ggml_backend|0x|failed to allocate/.test(e.message), text);
    assert.deepEqual(await readdir(join(dir, 'runtimes', 'run')), [], 'no key file left');
    assert.equal(rt.running(), null);
    assert.equal(runtimePorts.size, 0, 'no port left registered');
  }
});

test('LM-9: two callers asking at once share one start; a different model stops the running one first', async (t) => {
  const { rt, runtimeDir, modelFile, launched } = await setup(t);
  const [a, b] = await Promise.all([rt.ensure({ runtimeDir, modelFile, modelId: 'one', ctx: 8192, gpu: false }), rt.ensure({ runtimeDir, modelFile, modelId: 'one', ctx: 8192, gpu: false })]);
  assert.equal(a.pid, b.pid);
  assert.equal(launched.length, 1);
  const first = a.pid;
  const c = await rt.ensure({ runtimeDir, modelFile, modelId: 'two', ctx: 8192, gpu: false });
  assert.notEqual(c.pid, first);
  assert.equal(launched.length, 2);
  await new Promise((r) => setTimeout(r, 300));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(first), false, 'the first server is gone');
});

test('LM-11: the idle stop fires after the chosen minutes and each request resets it; "only when Bunny closes" never fires', async (t) => {
  const dir = await temp(t);
  const timers = [];
  const idle = { set: (fn, ms) => { const h = { fn, ms, cleared: false, unref() {} }; timers.push(h); return h; }, clear: (h) => { if (h) h.cleared = true; } };
  const zip = join(dir, 'x.zip'); await writeFile(zip, makeZip([{ name: 'llama-server.exe', data: 'MZ' }]));
  const pins = { 'llama-server': { tag: 'b1', entry: 'llama-server.exe', skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'], files: { cpu: { sha256: 'x', allow: ['llama-server.exe'] } } } };
  const runtimeDir = join(dir, 'rt'); await installFromZip({ zip, dir: runtimeDir, pins, backend: 'cpu' });
  await mkdir(join(dir, 'models'), { recursive: true }); await writeFile(join(dir, 'models', 'm.gguf'), 'OK');
  const rt = createLocalRuntime({ dataDir: dir, idle, healthWaitMs: 15000, launch: async ({ args, cwd, env }) => spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH } }) });
  t.after(() => rt.stop());
  t.after(() => new Promise((r) => setTimeout(r, 300)));
  await rt.ensure({ runtimeDir, modelFile: join(dir, 'models', 'm.gguf'), modelId: 'a', ctx: 8192, gpu: false });
  assert.equal(timers.at(-1).ms, 10 * 60_000, 'the default is 10 minutes');
  const before = timers.length;
  rt.touch();
  assert.equal(timers.length, before + 1, 'a request sets a new timer');
  assert.equal(timers[before - 1].cleared, true, 'and clears the old one');
  rt.setIdleMinutes(30);
  assert.equal(timers.at(-1).ms, 30 * 60_000);
  rt.setIdleMinutes(0);
  assert.equal(timers.at(-1).cleared || timers.at(-1).ms === 30 * 60_000, true);
  const n = timers.length; rt.touch(); assert.equal(timers.length, n, 'no timer at all');
  assert.throws(() => rt.setIdleMinutes(7));
  await rt.stop();
});

test('LM-12: a start refuses when the program changed, and when it is missing, before anything is launched', async (t) => {
  const { rt, runtimeDir, modelFile, launched } = await setup(t);
  await writeFile(join(runtimeDir, 'llama-server.exe'), 'tampered');
  await assert.rejects(rt.ensure({ runtimeDir, modelFile, modelId: 'x', ctx: 8192, gpu: false }), (e) => e.code === 'local.changed');
  await assert.rejects(rt.ensure({ runtimeDir: join(runtimeDir, 'nope'), modelFile, modelId: 'x', ctx: 8192, gpu: false }), (e) => e.code === 'local.missing');
  assert.equal(launched.length, 0);
});

test('LM-12: after a crash, leftover key files are swept and only llama-server.exe under <data>/runtimes/ is named for killing', async (t) => {
  const { dir, rt } = await setup(t);
  await mkdir(join(dir, 'runtimes', 'run'), { recursive: true });
  await writeFile(join(dir, 'runtimes', 'run', 'left.key'), 'old');
  await rt.sweepKeys();
  assert.equal(existsSync(join(dir, 'runtimes', 'run', 'left.key')), false);
  const cmd = leftoverCommand(dir);
  assert.match(cmd, /Name='llama-server\.exe'/);
  assert.ok(cmd.includes(join(dir, 'runtimes')));
  assert.match(cmd, /StartsWith/);
  assert.match(plainReason('Vulkan: no devices found').message, /graphics card/);
});

test('Security L1: if the key file cannot be locked to its owner, nothing starts and no key file is left behind', async (t) => {
  const { dir, modelFile, runtimeDir, launched } = await setup(t);
  const rt = createLocalRuntime({ dataDir: dir, launch: async () => { throw new Error('must not launch'); }, lockKey: async () => false });
  await assert.rejects(rt.ensure({ runtimeDir, modelId: 'm', modelFile, ctx: 8192, gpu: false }), (e) => e.code === 'local.keyLock');
  assert.equal(launched.length, 0);
  assert.deepEqual(existsSync(join(dir, 'runtimes', 'run')) ? readdirSync(join(dir, 'runtimes', 'run')) : [], []);
});

test('LF-9 and LF-4: a file with no chat format gets only --chat-template chatml; no other template flag, no projector, draft model or slot-save path is ever passed', () => {
  const base = { model: 'C:\m\q.gguf', port: 51234, keyFile: 'C:\d\k.key', ctx: 8192 };
  assert.deepEqual(buildArgv({ ...base, chatTemplate: 'chatml' }).slice(-2), ['--chat-template', 'chatml']);
  assert.ok(!buildArgv(base).includes('--chat-template'));
  assert.ok(!buildArgv({ ...base, chatTemplate: 'llama3' }).includes('--chat-template'), 'any other format name is dropped, not passed');
  const argv = buildArgv({ ...base, chatTemplate: 'chatml' });
  assert.doesNotThrow(() => checkArgv(argv));
  for (const bad of ['--chat-template-file', '--mmproj', '-md', '--model-draft', '--slot-save-path', '-mm']) assert.throws(() => checkArgv([...argv, bad, 'x']), /never uses/, bad);
  assert.throws(() => checkArgv([...argv.slice(0, -1), 'llama3']), /plain chat format/);
});

test('T1: a call that is still open is never cut off by the idle stop, and a switch to another model waits for it; the idle stop works again once it ends', async (t) => {
  const dir = await temp(t);
  const timers = [];
  const idle = { set: (fn, ms) => { const h = { fn, ms, cleared: false, unref() {} }; timers.push(h); return h; }, clear: (h) => { if (h) h.cleared = true; } };
  const zip = join(dir, 'x.zip'); await writeFile(zip, makeZip([{ name: 'llama-server.exe', data: 'MZ' }]));
  const pins = { 'llama-server': { tag: 'b1', entry: 'llama-server.exe', skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'], files: { cpu: { sha256: 'x', allow: ['llama-server.exe'] } } } };
  const runtimeDir = join(dir, 'rt'); await installFromZip({ zip, dir: runtimeDir, pins, backend: 'cpu' });
  await mkdir(join(dir, 'models'), { recursive: true }); await writeFile(join(dir, 'models', 'a.gguf'), 'OK'); await writeFile(join(dir, 'models', 'b.gguf'), 'OK');
  const rt = createLocalRuntime({ dataDir: dir, idle, healthWaitMs: 15000, launch: async ({ args, cwd, env }) => spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH } }) });
  t.after(() => rt.stop());
  t.after(() => new Promise((r) => setTimeout(r, 300)));
  const a = { runtimeDir, modelFile: join(dir, 'models', 'a.gguf'), modelId: 'a', ctx: 8192, gpu: false };
  await rt.ensure(a);
  const end = rt.begin();
  assert.equal(rt.inflight(), 1);
  timers.at(-1).fn(); // the idle time passes while the reply is still arriving
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(rt.running()?.modelId, 'a', 'not stopped in the middle of a reply');
  assert.equal(timers.at(-1).cleared, false, 'the timer is set again');
  // another chat asks for another model while the reply is streaming: it waits
  let switched = false;
  const sw = rt.ensure({ ...a, modelFile: join(dir, 'models', 'b.gguf'), modelId: 'b' }).then(() => { switched = true; });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(switched, false, 'the switch waits for the stream');
  assert.equal(rt.running()?.modelId, 'a');
  end(); end(); // ending twice counts once
  await sw;
  assert.equal(rt.running()?.modelId, 'b');
  assert.equal(rt.inflight(), 0);
  timers.at(-1).fn(); // idle, and nothing in flight: it stops
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(rt.running(), null);
});
