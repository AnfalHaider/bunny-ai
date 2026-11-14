import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeModels, discoverModels } from '../src/providers/discovery.js';
import { createProviderRegistry, memorySecretStore, ConnectError } from '../src/providers/connections.js';

const ok = async () => ({ ok: true, status: 200 });

// Shapes taken from real providers: OpenAI-compatible (Nvidia, OpenAI, OpenRouter),
// a bare array, and an Anthropic-style envelope.
const NVIDIA_SHAPE = {
  object: 'list',
  data: [
    { id: 'meta/llama-3.1-70b-instruct', object: 'model', created: 1726000000, owned_by: 'meta' },
    { id: 'nvidia/nemotron-4-340b-instruct', object: 'model', created: 1726000000, owned_by: 'nvidia' },
  ],
};

const ANTHROPIC_SHAPE = {
  data: [{ id: 'example-large-5', display_name: 'Example Large 5', created_at: '2026-01-01T00:00:00Z' }],
};

/** @param {Response|{status:number, ok?:boolean, json?:()=>any}} spec */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

// --- normalisation -------------------------------------------------------

test('normalises an OpenAI-compatible list', () => {
  const models = normalizeModels(NVIDIA_SHAPE);
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], {
    id: 'meta/llama-3.1-70b-instruct',
    displayName: 'meta/llama-3.1-70b-instruct',
    ownedBy: 'meta',
    contextLength: null,
  });
});

test('keeps a provider display name when one is given', () => {
  assert.equal(normalizeModels(ANTHROPIC_SHAPE)[0].displayName, 'Example Large 5');
});

test('accepts a bare array and a models envelope', () => {
  assert.equal(normalizeModels([{ id: 'a' }])[0].id, 'a');
  assert.equal(normalizeModels({ models: [{ id: 'b' }] })[0].id, 'b');
});

test('de-duplicates and sorts by id', () => {
  const models = normalizeModels([{ id: 'z' }, { id: 'a' }, { id: 'z' }]);
  assert.deepEqual(models.map((m) => m.id), ['a', 'z']);
});

test('skips rows without an id instead of inventing one', () => {
  const models = normalizeModels([{ id: 'a' }, { name: '' }, null, { foo: 1 }]);
  assert.deepEqual(models.map((m) => m.id), ['a']);
});

test('reads a context length when the provider sends one', () => {
  assert.equal(normalizeModels([{ id: 'a', context_length: 128000 }])[0].contextLength, 128000);
});

test('rejects a payload that is not a model list', () => {
  assert.throws(() => normalizeModels({ error: 'nope' }), (e) => e.code === 'discovery.malformed');
});

// --- transport -----------------------------------------------------------

test('sends the bearer token and calls /models', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, json: async () => NVIDIA_SHAPE }));
  await discoverModels({ baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'nvapi-test', fetchImpl });
  assert.equal(fetchImpl.calls[0].url, 'https://integrate.api.nvidia.com/v1/models');
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer nvapi-test');
});

test('a rejected key is reported as unauthorized', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(
    () => discoverModels({ baseUrl: 'https://x.test/v1', apiKey: 'bad', fetchImpl }),
    (e) => e instanceof ConnectError && e.code === 'discovery.unauthorized',
  );
});

test('a server error is reported with its status', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(
    () => discoverModels({ baseUrl: 'https://x.test/v1', fetchImpl }),
    (e) => e.code === 'discovery.http' && /503/.test(e.message),
  );
});

test('non-JSON is reported as malformed', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }));
  await assert.rejects(() => discoverModels({ baseUrl: 'https://x.test/v1', fetchImpl }), (e) => e.code === 'discovery.malformed');
});

test('a hung provider times out', async () => {
  const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(
    () => discoverModels({ baseUrl: 'https://x.test/v1', fetchImpl: abort, timeoutMs: 5 }),
    (e) => e.code === 'discovery.timeout',
  );
});

test('an unreachable provider is reported as unreachable', async () => {
  await assert.rejects(
    () => discoverModels({ baseUrl: 'https://x.test/v1', fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    (e) => e.code === 'discovery.unreachable',
  );
});

// --- registry integration ------------------------------------------------

function registryWith(discover, probe = ok) {
  const secrets = memorySecretStore();
  const registry = createProviderRegistry({ secrets, probe, discover });
  return { secrets, registry };
}

test('registry.models returns the provider list', async () => {
  const discover = async () => normalizeModels(NVIDIA_SHAPE);
  const { registry } = registryWith(discover);
  await registry.connect('nvidia', { apiKey: 'nvapi-1234567890' });
  const models = await registry.models('nvidia');
  assert.deepEqual(models.map((m) => m.id).sort(), ['meta/llama-3.1-70b-instruct', 'nvidia/nemotron-4-340b-instruct']);
});

test('registry.models passes the stored key, not the masked one', async () => {
  let seen;
  const discover = async (opts) => { seen = opts; return []; };
  const { registry } = registryWith(discover);
  await registry.connect('nvidia', { apiKey: 'nvapi-1234567890' });
  await registry.models('nvidia');
  assert.equal(seen.apiKey, 'nvapi-1234567890');
  assert.equal(seen.baseUrl, 'https://integrate.api.nvidia.com/v1');
});

test('the model list is cached, and refresh bypasses the cache', async () => {
  let calls = 0;
  const discover = async () => { calls += 1; return [{ id: `m${calls}` }]; };
  const { registry } = registryWith(discover);
  await registry.connect('nvidia', { apiKey: 'nvapi-1234567890' });

  await registry.models('nvidia');
  await registry.models('nvidia');
  assert.equal(calls, 1);

  const fresh = await registry.models('nvidia', { refresh: true });
  assert.equal(calls, 2);
  assert.deepEqual(fresh.map((m) => m.id), ['m2']);
});

test('an unconnected provider has no models', async () => {
  const { registry } = registryWith(async () => []);
  await assert.rejects(() => registry.models('nvidia'), (e) => e.code === 'models.notConnected');
});

test('reconnecting drops the cached model list', async () => {
  let calls = 0;
  const discover = async () => { calls += 1; return [{ id: 'x' }]; };
  const { registry } = registryWith(discover);
  await registry.connect('nvidia', { apiKey: 'nvapi-1111111111' });
  await registry.models('nvidia');
  await registry.connect('nvidia', { apiKey: 'nvapi-2222222222' });
  await registry.models('nvidia');
  assert.equal(calls, 2);
});
