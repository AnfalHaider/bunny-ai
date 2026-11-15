import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';
import { findProvider } from '../src/providers/catalog.js';
import { memorySecretStore } from '../src/providers/connections.js';

test('ModelScope, SiliconFlow and Gitee AI are ready to connect with their own addresses', () => {
  assert.equal(findProvider('modelscope').defaultBaseUrl, 'https://api-inference.modelscope.cn/v1');
  assert.equal(findProvider('siliconflow').defaultBaseUrl, 'https://api.siliconflow.cn/v1');
  assert.equal(findProvider('gitee-ai').defaultBaseUrl, 'https://ai.gitee.com/v1');
  for (const id of ['deepseek', 'moonshot', 'zhipu', 'dashscope', 'groq', 'together', 'mistral', 'xai', 'fireworks', 'cerebras']) {
    assert.equal(findProvider(id)?.kind, 'apiKey', id);
    assert.match(findProvider(id).defaultBaseUrl, /^https:\/\//, id);
  }
});

/** An OpenAI-compatible server that wants its key in an "api-key" header. */
async function gateway(t) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['api-key'], body: body ? JSON.parse(body) : null });
      if (req.headers['api-key'] !== 'gw-secret-123') { res.writeHead(401).end('{}'); return; }
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gateway-model' }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello from the gateway' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

test('a custom provider is added, chats with its own key header, survives a restart, and can be removed', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-custom-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const gw = await gateway(t);
  const { base } = await startApp(t, { dataDir, fake: false, probe: null, discover: null });

  const bad = await post(base, '/api/providers/custom', { name: 'Office gateway', baseUrl: gw.url, apiKey: 'wrong-key-000', authHeader: 'api-key' });
  assert.equal(bad.status, 400, 'a key the server refuses is not kept');
  assert.ok(!(await json(base, '/api/providers')).body.some((p) => p.id === 'custom-office-gateway'));

  const added = await post(base, '/api/providers/custom', { name: 'Office gateway', baseUrl: gw.url, apiKey: 'gw-secret-123', authHeader: 'api-key' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.id, 'custom-office-gateway');
  assert.equal(added.body.custom, true);
  assert.equal(added.body.status, 'connected');
  assert.ok(!JSON.stringify(added.body).includes('gw-secret-123'), 'the key is never sent back');

  const models = await json(base, '/api/providers/custom-office-gateway/models');
  assert.deepEqual(models.body.map((m) => m.id), ['gateway-model']);

  const { body: session } = await post(base, '/api/sessions', { title: 'Through the gateway' });
  const reply = await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hi', providerId: 'custom-office-gateway', model: 'gateway-model' }),
  }).then((r) => r.text());
  assert.match(reply, /hello from the gateway/);
  assert.equal(gw.seen.at(-1).key, 'gw-secret-123');

  // A built-in name cannot be taken.
  const clash = await post(base, '/api/providers/custom', { name: 'x', baseUrl: gw.url });
  assert.notEqual(clash.body?.id, 'openai');
});

test('custom providers come back after a restart', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-custom-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const gw = await gateway(t);
  // One key store for both starts, as the real credential store would be.
  const secretStore = memorySecretStore();
  const first = await startApp(t, { dataDir, fake: false, probe: null, discover: null, secretStore });
  await post(first.base, '/api/providers/custom', { name: 'Office gateway', baseUrl: gw.url, apiKey: 'gw-secret-123', authHeader: 'api-key' });
  await new Promise((r) => { first.app.server.close(r); first.app.server.closeAllConnections?.(); });

  // Same profile, same secret store: a fresh start.
  const second = await startApp(t, { dataDir, fake: false, probe: null, discover: null, secretStore });
  const row = (await json(second.base, '/api/providers')).body.find((p) => p.id === 'custom-office-gateway');
  assert.equal(row?.status, 'connected');
  assert.equal(row?.custom, true);

  const removed = await json(second.base, '/api/providers/custom-office-gateway', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.ok(!(await json(second.base, '/api/providers')).body.some((p) => p.id === 'custom-office-gateway'));
  const builtIn = await json(second.base, '/api/providers/openai', { method: 'DELETE' });
  assert.equal(builtIn.status, 404, 'built-in providers are not removable');
});
