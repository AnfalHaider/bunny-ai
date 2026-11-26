/**
 * LOCAL-MODELS: a status read that straddles the end of set-up must never say "installed" with a PC line taken from before it (the gate failure in "a PC with an NVIDIA card gets the Vulkan build").
 * status() took the PC snapshot, waited on the model rows, then read `installed` live; set-up replaces the state meanwhile. Polling status in a tight loop with a one-model list hit it in about 7 runs of 10.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRealLocalModels } from '../src/server/localModelsReal.js';
import { makeZip } from './helpers-archives.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const GB = 1024 ** 3;
const ZIP = makeZip([{ name: 'llama-server.exe', data: 'MZ' }, { name: 'ggml.dll', data: 'd' }]);
const url = (n) => `https://github.com/ggml-org/llama.cpp/releases/download/b12760/${n}`;
const file = (name) => ({ name, url: url(name), size: ZIP.length, sha256: sha(ZIP), kind: 'zip', allowComplete: true, allow: ['llama-server.exe', 'ggml.dll'] });
const PINS = { 'llama-server': { tag: 'b12760', licence: 'MIT', entry: 'llama-server.exe', signed: false, hosts: ['github.com', 'release-assets.githubusercontent.com'], skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'], files: { cpu: file('x.zip'), vulkan: file('v.zip') } } };
const MODEL = { id: 'tiny', name: 'Tiny 1B', publisher: 'Acme', family: 'tiny', repo: 'Acme/Tiny-GGUF', revision: 'a'.repeat(40), file: 'tiny-q4.gguf', size: 4096, sha256: 'b'.repeat(64), licence: 'apache-2.0', gated: false, tools: true, toolsProof: 'S-LM2', kvBytesPerToken: 1024, nativeCtx: 32768 };
const hub = async (u) => (new URL(u).hostname === 'github.com' ? { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x' }, body: [] } : { status: 200, headers: {}, body: (async function* () { yield ZIP; })() });

test('a status read that straddles the end of set-up never says installed without the card (40 tight-loop runs, one model in the list)', async () => {
  let bad = 0;
  for (let i = 0; i < 40; i++) {
    const dir = await mkdtemp(join(tmpdir(), 'bunny-race-'));
    const lm = createRealLocalModels({
      dataDir: dir, list: [MODEL], pins: PINS, fetchImpl: hub, vulkanRecorded: true, gpuInfo: async () => ({ vendor: 'NVIDIA', name: 'NVIDIA GeForce RTX 3060' }),
      trial: async () => ({ ok: true, devices: [{ name: 'NVIDIA GeForce RTX 3060', totalBytes: 12 * GB, freeBytes: 11 * GB }] }), launch: async () => { throw new Error('nothing starts here'); },
    });
    try {
      await lm.load(); await lm.setUp();
      for (;;) {
        const s = await lm.status();
        if (s.installed) { if (s.pc.gpuName !== 'NVIDIA GeForce RTX 3060' || s.pc.vram !== 12 * GB || s.runtime.backend !== 'vulkan') bad += 1; break; }
      }
    } finally { await lm.stopAll(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  }
  assert.equal(bad, 0, `${bad} of 40 reads said installed with a PC line from before it`);
});
