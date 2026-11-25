import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// ENGINE-SWITCH (server side, v0.1.15): a chat on Bunny's engine changes a file, switches to Codex, then Claude Code, then back to Bunny. Driven through the API (the switch control is not built yet)
// with the stand-in engines and the invented profile: the divider is in the chat, the handover reached the engine (its size is kept with the reply), the file is the chat's checkpoint, and the route
// is refused where it must be.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {});
  await request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true } }).catch(() => {});
});
test.afterEach(async ({ request }) => {
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {});
  await request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true } }).catch(() => {});
});

async function downloaded(request, id) {
  expect((await request.post(`/api/engines/${id}/download`, { data: {} })).status()).toBe(202);
  await expect.poll(async () => (await (await request.get('/api/engines')).json()).engines.find((e) => e.id === id).downloaded, { timeout: 15_000 }).toBe(true);
}
async function say(request, id, content, model) {
  const res = await request.post(`/api/sessions/${id}/messages`, { data: { content, providerId: model.providerId, model: model.id, workMode: 'code' } });
  expect(res.ok()).toBeTruthy();
  return res.text();
}

test('a chat on Bunny changes a file, switches to Codex, Claude Code and back: the divider, the handover and the checkpoint all follow', async ({ request }) => {
  await request.post('/api/providers/anthropic/connect', { data: { apiKey: 'sk-test-000000000000' } });
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  const models = await (await request.get('/api/models')).json();
  const model = (Array.isArray(models) ? models : models.models)[0];
  const folder = mkdtempSync(join(tmpdir(), 'bunny-switch-e2e-'));
  const { id } = await (await request.post('/api/sessions', { data: { title: 'Switch me', workMode: 'code', folder, permissionMode: 'auto' } })).json();

  // 1. Bunny's engine writes a file (Auto mode: no card)
  await say(request, id, '[[call write_file {"path":"notes.txt","content":"from bunny"}]]', model);
  expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toBe('from bunny');
  await downloaded(request, 'codex');

  // 2. switch to Codex: refused for a device (see the unit test), allowed here; the divider is in the chat
  const toCodex = await request.post(`/api/sessions/${id}/engine`, { data: { to: 'codex' } });
  expect(toCodex.status()).toBe(200);
  let chat = await (await request.get(`/api/sessions/${id}`)).json();
  expect(chat.engine.id).toBe('codex');
  expect(chat.messages.filter((m) => m.kind === 'engine-switch').map((m) => [m.from, m.to])).toEqual([['bunny', 'codex']]);

  // 3. Codex answers; its reply records the handover it was given (Codex gets one on every turn): messages and the one file the chat changed
  await say(request, id, 'which files have we changed?', model);
  chat = await (await request.get(`/api/sessions/${id}`)).json();
  const reply = chat.messages.filter((m) => m.role === 'assistant' && m.handover).at(-1);
  expect(reply, 'the Codex reply keeps the size of its handover').toBeTruthy();
  expect(reply.handover.files).toBe(1);
  expect(reply.handover.messages).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(chat)).not.toContain('<<<BUNNY HANDOVER');

  // 4. the engine list explains a missing engine: Claude Code is not downloaded
  const missing = await request.post(`/api/sessions/${id}/engine`, { data: { to: 'claude-code' } });
  expect(missing.status()).toBe(409);
  expect((await missing.json()).code).toBe('engine.notDownloaded');

  // 5. back to Bunny's engine: allowed, and the checkpoint of the first reply is still the chat's
  const toBunny = await request.post(`/api/sessions/${id}/engine`, { data: { to: 'bunny' } });
  expect(toBunny.status()).toBe(200);
  chat = await (await request.get(`/api/sessions/${id}`)).json();
  expect(chat.engine.id).toBe('bunny');
  expect(chat.engine.handoverPending).toBe(true);
  expect(chat.messages.filter((m) => m.kind === 'engine-switch').map((m) => m.to)).toEqual(['codex', 'bunny']);
  expect(chat.messages.some((m) => m.checkpoint?.id), 'the reply that changed the file still has its checkpoint').toBe(true);
});
