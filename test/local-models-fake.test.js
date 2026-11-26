/**
 * LOCAL-MODELS in fake mode: the card's state and the window's buttons, the fit badges, the chat menu group, and the managed provider's rules.
 * An invented profile, an invented list and PC; nothing is downloaded or run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, post, json } from './helpers.js';

const get = async (base, path) => (await fetch(`${base}${path}`)).json();
const wait = async (fn, ms = 4000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

test('the card starts Not set up; set-up finishes by itself; the list shows a fit badge for every model', async (t) => {
  const { base } = await startApp(t);
  const s0 = await get(base, '/api/local-models');
  assert.equal(s0.installed, false);
  assert.equal(s0.fake, true);
  assert.equal(s0.program.sizeMB, 39);
  await post(base, '/api/local-models/setup', {});
  const s1 = await wait(async () => { const s = await get(base, '/api/local-models'); return s.installed ? s : null; });
  assert.equal(s1.runtime.backend, 'vulkan');
  assert.deepEqual(s1.runtime.idleChoices, [5, 10, 30, 60, 0]);
  assert.equal(s1.runtime.idleMinutes, 10);
  const byId = Object.fromEntries(s1.models.map((m) => [m.id, m]));
  assert.equal(byId['gpt-oss-20b'].fit, 'too-big');
  assert.equal(byId['gpt-oss-20b'].canDownload, false);
  assert.ok(['fits-gpu', 'tight', 'slow'].includes(byId['qwen3-4b'].fit));
  assert.equal(byId['ministral-3-3b'].tools, false, 'chat only');
});

test('a download runs to Ready; the model then appears in the chat menu under Bunny local, and the provider counts as connected', async (t) => {
  const { base } = await startApp(t);
  assert.equal((await get(base, '/api/providers')).find((p) => p.id === 'bunny-local').status, 'disconnected');
  await post(base, '/api/local-models/setup', {});
  await wait(async () => (await get(base, '/api/local-models')).installed);
  const started = await post(base, '/api/local-models/download', { id: 'qwen3-4b' });
  assert.equal(started.status, 200);
  await wait(async () => (await get(base, '/api/local-models')).models.find((m) => m.id === 'qwen3-4b').state === 'ready');
  const provider = (await get(base, '/api/providers')).find((p) => p.id === 'bunny-local');
  assert.equal(provider.status, 'connected');
  assert.equal(provider.baseUrl, '', 'no address stored for Bunny local');
  assert.equal(provider.maskedKey, '');
  const menu = (await get(base, '/api/models')).filter((m) => m.providerId === 'bunny-local');
  assert.deepEqual(menu.map((m) => m.displayName), ['Qwen3 4B']);
  assert.equal(menu[0].providerName, 'Bunny local');
});

test('a Too big model cannot be downloaded; an unknown model, a bad idle choice and a bad switch are refused with a reason', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/local-models/setup', {});
  await wait(async () => (await get(base, '/api/local-models')).installed);
  const big = await post(base, '/api/local-models/download', { id: 'gpt-oss-20b' });
  assert.equal(big.status, 400);
  assert.equal(big.body.code, 'local.tooBig');
  assert.equal((await post(base, '/api/local-models/download', { id: 'not-a-model' })).status, 404);
  assert.equal((await post(base, '/api/local-models/settings', { idleMinutes: 7 })).status, 400);
  assert.equal((await post(base, '/api/local-models/settings', { useGpu: 'yes' })).status, 400);
  const ok = await post(base, '/api/local-models/settings', { idleMinutes: 30, useGpu: false });
  assert.equal(ok.body.runtime.idleMinutes, 30);
  assert.equal(ok.body.runtime.useGpu, false);
});

test('pause, resume, cancel and delete move a model through its states; Remove Bunny local clears everything', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/local-models/setup', {});
  await wait(async () => (await get(base, '/api/local-models')).installed);
  const state = async (id) => (await get(base, '/api/local-models')).models.find((m) => m.id === id).state;
  await post(base, '/api/local-models/download', { id: 'qwen3-8b' });
  await post(base, '/api/local-models/pause', { id: 'qwen3-8b' });
  assert.equal(await state('qwen3-8b'), 'paused');
  await post(base, '/api/local-models/resume', { id: 'qwen3-8b' });
  await wait(async () => (await state('qwen3-8b')) === 'ready');
  await json(base, '/api/local-models/qwen3-8b', { method: 'DELETE' });
  assert.equal(await state('qwen3-8b'), 'none');
  await post(base, '/api/local-models/download', { id: 'ministral-3-3b' });
  await post(base, '/api/local-models/cancel', { id: 'ministral-3-3b' });
  assert.equal(await state('ministral-3-3b'), 'none');
  await json(base, '/api/local-models', { method: 'DELETE' });
  assert.equal((await get(base, '/api/local-models')).installed, false);
});

test('LM-1: Bunny local cannot be connected with an address or a key', async (t) => {
  const { base } = await startApp(t);
  const r = await post(base, '/api/providers/bunny-local/connect', { baseUrl: 'http://127.0.0.1:9/v1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'provider.managed');
});

test('LM-13: a device that is not running the model gets local.notRunning from ensure(); the window may start it', async () => {
  const { createLocalModels } = await import('../src/server/localModels.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const lm = createLocalModels({ dataDir: await mkdtemp(join(tmpdir(), 'bunny-lm-')), fake: true });
  await lm.setUp();
  await wait(async () => (await lm.status()).installed);
  await lm.download('qwen3-4b');
  await wait(async () => (await lm.status()).models.find((m) => m.id === 'qwen3-4b').state === 'ready');
  await assert.rejects(lm.ensure('qwen3-4b', { who: 'device' }), (e) => e.code === 'local.notRunning');
  await lm.ensure('qwen3-4b', { who: 'window' });
  assert.equal((await lm.ensure('qwen3-4b', { who: 'device' })).id, 'qwen3-4b', 'once it runs, a device may chat with it');
});
