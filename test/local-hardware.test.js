/** LOCAL-MODELS: graphics card detection, the card's memory from --list-devices, and the trial run. Invented JSON and a stand-in server; nothing touches the real PC's programs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { parseVideoControllers, parseListDevices, createTrial, detectGpu } from '../src/server/localHardware.js';
import { spawnTracked } from '../src/server/localRuntime.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-llama-server.mjs', import.meta.url));
const MiB = 1024 * 1024;

test('the video controllers: a real NVIDIA card is preferred to the processor graphics; virtual adapters never count', () => {
  const raw = JSON.stringify([{ Name: 'Intel(R) UHD Graphics 770', AdapterCompatibility: 'Intel Corporation' }, { Name: 'NVIDIA GeForce RTX 3060', AdapterCompatibility: 'NVIDIA' }, { Name: 'Microsoft Basic Display Adapter', AdapterCompatibility: 'Microsoft' }]);
  assert.deepEqual(parseVideoControllers(raw), { vendor: 'NVIDIA', name: 'NVIDIA GeForce RTX 3060' });
  assert.deepEqual(parseVideoControllers(JSON.stringify({ Name: 'Intel(R) Arc(TM) A380', AdapterCompatibility: 'Intel Corporation' })), { vendor: 'Intel', name: 'Intel(R) Arc(TM) A380' });
  assert.deepEqual(parseVideoControllers(JSON.stringify({ Name: 'AMD Radeon RX 6600', AdapterCompatibility: 'Advanced Micro Devices, Inc.' })).vendor, 'AMD');
  assert.equal(parseVideoControllers(JSON.stringify([{ Name: 'Microsoft Basic Display Adapter' }, { Name: 'VMware SVGA 3D' }])), null);
  assert.equal(parseVideoControllers('not json'), null);
  assert.equal(parseVideoControllers(''), null);
});

test('detectGpu asks PowerShell once, read-only, and answers null when it fails or there is no PowerShell', async () => {
  const calls = [];
  const run = async (file, args) => { calls.push(args.join(' ')); return { ok: true, stdout: '{"Name":"NVIDIA GeForce GTX 1650","AdapterCompatibility":"NVIDIA"}' }; };
  assert.equal((await detectGpu({ run, powershell: 'powershell.exe' })).vendor, 'NVIDIA');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Get-CimInstance Win32_VideoController/);
  assert.doesNotMatch(calls[0], /Set-|Remove-|Invoke-|Start-/);
  assert.equal(await detectGpu({ run: async () => ({ ok: false, stdout: '' }), powershell: 'powershell.exe' }), null);
  assert.equal(await detectGpu({ run, powershell: null }), null);
});

test('--list-devices text gives the card, its memory and what is free', () => {
  const text = 'ggml_vulkan: Found 1 Vulkan devices:\nAvailable devices:\n  Vulkan0: NVIDIA GeForce RTX 3060 (12288 MiB, 11000 MiB free)\n  CPU: 13th Gen Intel(R) Core(TM) i7 (16000 MiB)\n';
  assert.deepEqual(parseListDevices(text), [
    { name: 'NVIDIA GeForce RTX 3060', totalBytes: 12288 * MiB, freeBytes: 11000 * MiB },
  ]);
  assert.deepEqual(parseListDevices('nothing here'), []);
});

const launch = async ({ args, cwd, env, capture }) => spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH }, capture });

test('the trial: --version must end with 0; on Vulkan the card memory comes from --list-devices', async () => {
  const trial = createTrial({ launch, env: () => ({ SystemRoot: process.env.SystemRoot ?? '' }) });
  const cpu = await trial(`${process.cwd()}/llama-server.exe`, 'cpu');
  assert.deepEqual(cpu, { ok: true, devices: [] });
  const vk = await trial(`${process.cwd()}/llama-server.exe`, 'vulkan');
  assert.equal(vk.ok, true);
  assert.deepEqual(vk.devices[0], { name: 'Stand-in GPU', totalBytes: 8192 * MiB, freeBytes: 6000 * MiB });
});

test('the trial fails when the program ends with an error, never starts, or does not end in time (and the straggler is killed)', async () => {
  const bad = createTrial({ launch: async () => ({ pid: 1, exited: Promise.resolve(3), output: () => '' }) });
  assert.equal((await bad('x')).ok, false);
  assert.equal((await createTrial({ launch: async () => { throw new Error('no helper'); } })('x')).ok, false);
  const killed = [];
  const hang = createTrial({ launch: async () => ({ pid: 77, exited: new Promise(() => {}), output: () => '' }), timeoutMs: 30, kill: async (pid) => killed.push(pid) });
  assert.equal((await hang('x')).ok, false);
  assert.deepEqual(killed, [77]);
});

test('Security L4: the trial can only run --version or --list-devices, with the same environment as a start', async () => {
  const seen = [];
  const trial = createTrial({ launch: async (o) => { seen.push(o); return { pid: 1, exited: Promise.resolve(0), output: () => '' }; }, dataDir: 'D:/invented' });
  await trial('D:/invented/runtimes/llama.cpp/b12760-cpu/llama-server.exe', 'vulkan');
  assert.deepEqual(seen.map((s) => s.args), [['--version'], ['--list-devices']]);
  assert.equal(seen[0].env.HF_HUB_OFFLINE, '1');
  assert.match(seen[0].env.LLAMA_CACHE, /models/);
  assert.equal(Object.keys(seen[0].env).some((k) => /^BUNNY_|KEY|TOKEN/i.test(k)), false);
});
