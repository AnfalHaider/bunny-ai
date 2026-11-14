import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultProbe, createProviderRegistry, memorySecretStore } from '../src/providers/connections.js';

/**
 * Script the responses a provider gives to anonymous and authenticated calls.
 * @param {{ anonymous: number, signed?: number }} spec
 */
function probeFetch({ anonymous, signed }) {
  const seen = [];
  const fn = async (url, init) => {
    const authorized = Boolean(init?.headers?.authorization);
    seen.push({ url, authorized });
    const status = authorized ? (signed ?? 200) : anonymous;
    return { ok: status >= 200 && status < 300, status };
  };
  fn.seen = seen;
  return fn;
}

const BASE = 'https://integrate.api.nvidia.com/v1';

test('a public model list connects but leaves the key unverified', async () => {
  const fetchImpl = probeFetch({ anonymous: 200 });
  const result = await defaultProbe({ baseUrl: BASE, apiKey: 'nvapi-looks-real' }, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.keyVerified, false);
  // one anonymous call only; no point spending a second request
  assert.equal(fetchImpl.seen.length, 1);
  assert.equal(fetchImpl.seen[0].authorized, false);
});

test('a guarded endpoint verifies a good key', async () => {
  const fetchImpl = probeFetch({ anonymous: 401, signed: 200 });
  const result = await defaultProbe({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-good' }, fetchImpl);
  assert.equal(result.keyVerified, true);
  assert.deepEqual(fetchImpl.seen.map((c) => c.authorized), [false, true]);
});

test('a guarded endpoint rejects a bad key', async () => {
  const fetchImpl = probeFetch({ anonymous: 401, signed: 401 });
  await assert.rejects(
    () => defaultProbe({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-bad' }, fetchImpl),
    (e) => e.code === 'probe.unauthorized',
  );
});

test('a guarded endpoint rejects a missing key', async () => {
  const fetchImpl = probeFetch({ anonymous: 401 });
  await assert.rejects(() => defaultProbe({ baseUrl: 'https://api.openai.com/v1' }, fetchImpl),
    (e) => e.code === 'probe.unauthorized');
});

test('a 5xx endpoint is unavailable', async () => {
  const fetchImpl = probeFetch({ anonymous: 503 });
  await assert.rejects(() => defaultProbe({ baseUrl: BASE, apiKey: 'k' }, fetchImpl),
    (e) => e.code === 'probe.unavailable');
});

test('a network failure is reported, not swallowed', async () => {
  await assert.rejects(
    () => defaultProbe({ baseUrl: BASE }, async () => { throw new TypeError('fetch failed'); }),
    (e) => e.code === 'probe.failed',
  );
});

test('the registry surfaces keyVerified for a public endpoint', async () => {
  const secrets = memorySecretStore();
  const registry = createProviderRegistry({
    secrets,
    probe: (cfg) => defaultProbe(cfg, probeFetch({ anonymous: 200 })),
  });
  const connected = await registry.connect('nvidia', { apiKey: 'nvapi-1234567890' });
  assert.equal(connected.status, 'connected');
  assert.equal(connected.keyVerified, false);
});

test('the registry surfaces keyVerified for a guarded endpoint', async () => {
  const secrets = memorySecretStore();
  const registry = createProviderRegistry({
    secrets,
    probe: (cfg) => defaultProbe(cfg, probeFetch({ anonymous: 401, signed: 200 })),
  });
  const connected = await registry.connect('openai', { apiKey: 'sk-1234567890' });
  assert.equal(connected.status, 'connected');
  assert.equal(connected.keyVerified, true);
});
