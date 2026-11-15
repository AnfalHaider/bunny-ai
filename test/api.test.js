import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

import { createApp } from '../src/server/app.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { ConnectError } from '../src/providers/errors.js';
import { PROVIDERS } from '../src/providers/catalog.js';

const MODELS = [
  { id: 'test-model-1', displayName: 'Test One', ownedBy: 'test', contextLength: null },
  { id: 'test-model-2', displayName: 'Test Two', ownedBy: 'test', contextLength: null },
];

/**
 * Start the real server on an ephemeral port with a memory secret store and a
 * stubbed network, and register teardown on the test so a failed assertion can
 * never leave a listening socket behind (that hangs the whole run).
 */
async function startApp(t, overrides = {}) {
  const dataDir = overrides.dataDir ?? (await mkdtemp(join(tmpdir(), 'bunny-api-')));
  const app = await createApp({
    dataDir,
    fake: true,
    secretStore: memorySecretStore(),
    probe: async () => ({ ok: true, keyVerified: true }),
    discover: async () => MODELS,
    localGuard: false, // S-1: this suite has no browser; the guard has its own suite
    ...overrides,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => {
      app.server.close(() => resolve());
      app.server.closeAllConnections?.();
    });
    if (overrides.dataDir === undefined) await rm(dataDir, { recursive: true, force: true });
  });

  return { app, base, dataDir };
}

const json = async (base, path, init) => {
  const res = await fetch(base + path, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
};

const post = (base, path, body) =>
  json(base, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

const put = (base, path, body) =>
  json(base, path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

test('health reports the app is up', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await json(base, '/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.fake, true);
});

test('every catalogue provider is listed and disconnected at first', async (t) => {
  const { base } = await startApp(t);
  const { body } = await json(base, '/api/providers');
  assert.equal(body.length, PROVIDERS.length);
  assert.ok(body.every((p) => p.status === 'disconnected'));
  assert.deepEqual(body.map((p) => p.name).slice(0, 3), ['Nvidia', 'OpenCode Go', 'OpenCode Console']);
});

test('connecting a provider flips its status and hides the key', async (t) => {
  const { base } = await startApp(t);
  const connected = await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-1234567890' });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.status, 'connected');
  assert.equal(connected.body.maskedKey, 'sk-…7890');

  const list = await json(base, '/api/providers');
  assert.equal(JSON.stringify(list.body).includes('sk-test-1234567890'), false);
});

test('a rejected key is a 400 with a machine-readable code', async (t) => {
  const { base } = await startApp(t);
  const res = await post(base, '/api/providers/openai/connect', { apiKey: 'short' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'apiKey.short');
  assert.equal(res.body.field, 'apiKey');
});

test('a probe failure leaves the provider in error, not connected', async (t) => {
  const { base } = await startApp(t, {
    probe: async () => {
      throw new ConnectError('probe.unauthorized', 'The provider rejected that key');
    },
  });
  const res = await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-1234567890' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'probe.unauthorized');

  const list = await json(base, '/api/providers');
  const openai = list.body.find((p) => p.id === 'openai');
  assert.equal(openai.status, 'error');
  assert.equal(openai.maskedKey, '');
});

test('models come back for a connected provider', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  const { status, body } = await json(base, '/api/providers/nvidia/models');
  assert.equal(status, 200);
  assert.deepEqual(body.map((m) => m.id), ['test-model-1', 'test-model-2']);
});

test('asking for models of a disconnected provider is a 400', async (t) => {
  const { base } = await startApp(t);
  const res = await json(base, '/api/providers/google/models');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'models.notConnected');
});

test('the combined picker list carries the provider name', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  const { body } = await json(base, '/api/models');
  assert.equal(body.length, 2);
  assert.equal(body[0].providerName, 'Nvidia');
  assert.equal(body[0].providerId, 'nvidia');
});

test('one dead provider does not empty the picker', async (t) => {
  let call = 0;
  const { base } = await startApp(t, {
    discover: async () => {
      call += 1;
      if (call === 1) throw new Error('rate limited');
      return MODELS;
    },
  });
  await post(base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-1234567890' });
  const { status, body } = await json(base, '/api/models');
  assert.equal(status, 200);
  assert.equal(body.length, 2);
});

test('disconnecting clears the provider', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-1234567890' });
  const res = await post(base, '/api/providers/openai/disconnect');
  assert.equal(res.body.status, 'disconnected');
  const list = await json(base, '/api/providers');
  assert.equal(list.body.find((p) => p.id === 'openai').status, 'disconnected');
});

test('connections survive a restart', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-api-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const first = await startApp(t, { dataDir });
  await post(first.base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  await new Promise((resolve) => {
    first.app.server.close(() => resolve());
    first.app.server.closeAllConnections?.();
  });

  const second = await startApp(t, { dataDir });
  const { body } = await json(second.base, '/api/providers');
  assert.equal(body.find((p) => p.id === 'nvidia').status, 'connected');
  assert.equal(body.find((p) => p.id === 'nvidia').maskedKey, 'nvapi-…7890');
});

test('sessions can be created, listed, read and deleted', async (t) => {
  const { base } = await startApp(t);
  const created = await post(base, '/api/sessions', { title: 'New chat' });
  assert.equal(created.status, 200);
  const id = created.body.id;

  const list = await json(base, '/api/sessions');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, id);

  const one = await json(base, `/api/sessions/${id}`);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.messages, []);

  const del = await json(base, `/api/sessions/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await json(base, `/api/sessions/${id}`)).status, 404);
});

test('an empty message is refused', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  const session = await post(base, '/api/sessions', {});
  const res = await post(base, `/api/sessions/${session.body.id}/messages`, { content: '   ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'message.empty');
});

test('a message without a chosen model is refused', async (t) => {
  const { base } = await startApp(t);
  const session = await post(base, '/api/sessions', {});
  const res = await post(base, `/api/sessions/${session.body.id}/messages`, { content: 'hi' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'model.notSelected');
});

test('a message to a disconnected provider is refused', async (t) => {
  const { base } = await startApp(t);
  const session = await post(base, '/api/sessions', {});
  const res = await post(base, `/api/sessions/${session.body.id}/messages`, {
    content: 'hi',
    providerId: 'openai',
    model: 'gpt-x',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'provider.notConnected');
});

test('a message streams deltas and stores both turns', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  const session = await post(base, '/api/sessions', {});

  const res = await fetch(`${base}/api/sessions/${session.body.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello there', providerId: 'nvidia', model: 'test-model-1' }),
  });
  assert.equal(res.headers.get('content-type').includes('text/event-stream'), true);
  const text = await res.text();
  assert.match(text, /event: delta/);
  assert.match(text, /event: done/);

  const stored = await json(base, `/api/sessions/${session.body.id}`);
  assert.equal(stored.body.messages.length, 2);
  assert.equal(stored.body.messages[0].role, 'user');
  assert.equal(stored.body.messages[1].role, 'assistant');
  assert.ok(stored.body.messages[1].content.length > 0);
  assert.equal(stored.body.title, 'hello there');
});

test('the chosen model is remembered on the session', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/providers/nvidia/connect', { apiKey: 'nvapi-1234567890' });
  const session = await post(base, '/api/sessions', {});
  await fetch(`${base}/api/sessions/${session.body.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hi', providerId: 'nvidia', model: 'test-model-2' }),
  }).then((r) => r.text());

  const stored = await json(base, `/api/sessions/${session.body.id}`);
  assert.equal(stored.body.model, 'test-model-2');
  assert.equal(stored.body.providerId, 'nvidia');
});

test('settings round-trip and persist to disk', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-api-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const first = await startApp(t, { dataDir });
  const res = await put(first.base, '/api/settings', {
    theme: 'dark',
    providerId: 'nvidia',
    model: 'test-model-1',
  });
  assert.equal(res.body.theme, 'dark');

  const got = await json(first.base, '/api/settings');
  assert.equal(got.body.model, 'test-model-1');

  await new Promise((resolve) => {
    first.app.server.close(() => resolve());
    first.app.server.closeAllConnections?.();
  });
  const second = await startApp(t, { dataDir });
  const again = await json(second.base, '/api/settings');
  assert.equal(again.body.theme, 'dark');
  assert.equal(again.body.providerId, 'nvidia');
});

test('the root redirects to the chat screen', async (t) => {
  const { base } = await startApp(t);
  const res = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/src/ui/index.html');
});

test('static files are served from the UI folder only', async (t) => {
  const { base } = await startApp(t);
  const ok = await fetch(base + '/src/ui/index.html');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/html/);

  // fetch() normalises "..", so the traversal must be sent on the wire.
  const { hostname, port } = new URL(base);
  const statusFor = (rawPath) =>
    new Promise((resolve, reject) => {
      const req = request({ hostname, port, path: rawPath, method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });

  // A well-formed URL normalises ".." before it reaches the handler, so these
  // end up as plain 404s; a Windows backslash survives and must hit the guard.
  const blocked = async (rawPath) => {
    const status = await statusFor(rawPath);
    assert.ok([403, 404].includes(status), `${rawPath} should be blocked, got ${status}`);
    return status;
  };

  assert.equal(await blocked('/src/ui/%2e%2e/%2e%2e/package.json'), 404);
  assert.equal(await blocked('/src/ui/../../package.json'), 404);
  assert.equal(await blocked('/src/ui/..%5c..%5cpackage.json'), 403);
  assert.equal(await blocked('/package.json'), 404);
  assert.equal(await statusFor('/src/ui/nope.css'), 404);
});

test('every screen a person can open is served', async (t) => {
  const { base } = await startApp(t);
  for (const screen of ['/src/ui/index.html', '/src/ui/providers.html', '/src/ui/settings.html',
    '/src/ui/automation.html', '/src/ui/app.css', '/src/ui/api.js', '/src/ui/chat.js',
    '/src/ui/markdown.js', '/src/ui/highlight.js']) {
    const res = await fetch(base + screen);
    assert.equal(res.status, 200, `${screen} should load`);
  }
});
