/**
 * S-1 must not break any provider: each kind of provider connects and answers one chat message
 * with the request guard ON, sending only what Bunny's own page sends (the launch token).
 * Paths where something other than Bunny's own page calls the local API, and why each still works:
 *   - Google sign-in return: GET /api/account/google/callback, one exception, valid in-flight state only
 *   - GitHub sign-in and provider OAuth (device code): started and finished by the page, with the token
 *   - speech audio, profile photo, screenshots, artifact frames: header-less GETs on an allow-list
 *   - the artifact iframe itself loads /raw; its own calls to the API are refused (Origin null)
 *   - the scheduler calls its own API with the token; Electron and `npm start` load pages that are given the token
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp } from './helpers.js';

const TOKEN = 'provider-suite-token';

/** fetch against the app the way its page does: with the launch token. */
function api(base) {
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { 'content-type': 'application/json', 'x-bunny-token': TOKEN, ...(init.headers ?? {}) } });
  const json = async (path, init) => { const r = await call(path, init); return { status: r.status, body: await r.json().catch(() => null) }; };
  const post = (path, body) => json(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return { call, json, post };
}

async function chatOnce(a, providerId, model) {
  const { body: session } = await a.post('/api/sessions', { title: 'guarded' });
  const res = await a.call(`/api/sessions/${session.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'hi', providerId, model }) });
  assert.equal(res.status, 200);
  return res.text();
}

/** A stand-in for an OpenAI-compatible server (a company gateway, or Ollama on this machine). */
async function openAiServer(t, { models = ['stand-in-model'], reply = 'hello from the stand-in', tags = false } = {}) {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (tags && req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: models.map((name) => ({ name, model: name })) }));
        return;
      }
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
        return;
      }
      if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('guard on: a key-based provider connects, lists models and answers a message', async (t) => {
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN });
  const a = api(base);
  assert.equal((await a.post('/api/providers/anthropic/connect', { apiKey: 'sk-test-000000000000' })).status, 200);
  const models = await a.json('/api/providers/anthropic/models');
  assert.ok(models.body.length > 0);
  assert.ok((await chatOnce(a, 'anthropic', models.body[0].id)).length > 0);
});

test('guard on: every catalogue key-based provider connects and answers (fake upstream)', async (t) => {
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN });
  const a = api(base);
  const list = (await a.json('/api/providers')).body.filter((p) => p.kind !== 'oauth' && !p.custom && p.id !== 'ollama');
  assert.ok(list.length >= 5, `${list.length} providers`);
  for (const p of list) {
    const c = await a.post(`/api/providers/${p.id}/connect`, { apiKey: 'sk-test-000000000000' });
    assert.equal(c.status, 200, `${p.id}: ${JSON.stringify(c.body)}`);
    const models = (await a.json(`/api/providers/${p.id}/models`)).body;
    assert.ok(models.length > 0, `${p.id} lists models`);
    assert.ok((await chatOnce(a, p.id, models[0].id)).length > 0, `${p.id} answers`);
  }
});

test('guard on: a custom OpenAI-compatible server connects and answers', async (t) => {
  const url = await openAiServer(t, { models: ['gateway-model'], reply: 'hello from the gateway' });
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN, fake: false, probe: null, discover: null });
  const a = api(base);
  const added = await a.post('/api/providers/custom', { name: 'Office gateway', baseUrl: url, apiKey: 'gw-secret-123', authHeader: 'api-key' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.match(await chatOnce(a, added.body.id, 'gateway-model'), /hello from the gateway/);
});

test('guard on: an Ollama-style local server (no key) connects and answers', async (t) => {
  const url = await openAiServer(t, { models: ['llama3.2:latest'], reply: 'from my own machine', tags: true });
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN, fake: false, probe: null, discover: null });
  const a = api(base);
  const added = await a.post('/api/providers/custom', { name: 'Local llama', baseUrl: url });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const models = (await a.json(`/api/providers/${added.body.id}/models`)).body;
  assert.ok(models.some((m) => m.id.startsWith('llama3.2')));
  assert.match(await chatOnce(a, added.body.id, models[0].id), /from my own machine/);
});

test('guard on: the sign-in routes answer the page (token) and refuse a stranger', async (t) => {
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN });
  const a = api(base);
  const oauth = (await a.json('/api/providers')).body.find((p) => p.kind === 'oauth');
  if (oauth) {
    const started = await a.post(`/api/oauth/${oauth.id}/start`);
    assert.notEqual(started.status, 403, 'the page may start a sign-in');
    const stranger = await fetch(`${base}/api/oauth/${oauth.id}/start`, { method: 'POST', headers: { origin: 'http://evil.example' } });
    assert.equal(stranger.status, 403);
  }
  assert.notEqual((await a.json('/api/account')).status, 403);
  assert.equal((await fetch(`${base}/api/account`)).status, 403, 'no token: refused');
});
