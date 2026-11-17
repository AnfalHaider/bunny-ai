import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDERS, KINDS, findProvider, fieldsFor } from '../src/providers/catalog.js';
import {
  createProviderRegistry,
  memorySecretStore,
  maskSecret,
  parseBaseUrl,
  validateInput,
  ConnectError,
} from '../src/providers/connections.js';

const ok = async () => ({ ok: true, status: 200 });

function setup(probe = ok) {
  const secrets = memorySecretStore();
  const registry = createProviderRegistry({ secrets, probe });
  return { secrets, registry };
}

const byId = (list, id) => list.find((p) => p.id === id);

// --- catalogue integrity -------------------------------------------------

test('provider ids are unique', () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every provider is complete and has a known kind', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.name, `${p.id} needs a name`);
    assert.ok(p.tagline, `${p.id} needs a tagline`);
    assert.ok(KINDS.includes(p.kind), `${p.id} has kind ${p.kind}`);
    assert.ok(fieldsFor(p).length >= 0);
  }
});

test('screenshot providers are all present', () => {
  for (const id of ['nvidia', 'opencode-go', 'opencode-console', 'anthropic', 'github-copilot',
    'openai', 'google', 'openrouter', 'vercel']) {
    assert.ok(findProvider(id), `missing provider ${id}`);
  }
});

test('oauth providers collect no secret fields', () => {
  assert.deepEqual(fieldsFor(findProvider('opencode-go')), []);
});

// --- secret handling -----------------------------------------------------

test('maskSecret keeps a short prefix and the last four characters', () => {
  assert.equal(maskSecret('nvapi-abcdef123456'), 'nvapi-…3456');
  assert.equal(maskSecret('abcdefgh'), '…efgh');
  assert.equal(maskSecret(''), '');
});

test('connect stores the secret and returns a masked projection', async () => {
  const { secrets, registry } = setup();
  const result = await registry.connect('openai', { apiKey: 'sk-test-1234567890' });
  assert.equal(result.status, 'connected');
  assert.equal(result.maskedKey, 'sk-…7890');
  assert.equal(await secrets.get('provider:openai'), 'sk-test-1234567890');
});

test('list() never contains the raw key', async () => {
  const { registry } = setup();
  const secret = 'sk-super-secret-value-4242';
  await registry.connect('openai', { apiKey: secret });
  assert.equal(JSON.stringify(registry.list()).includes(secret), false);
});

// --- validation ----------------------------------------------------------

test('missing key is refused', async () => {
  const { registry } = setup();
  await assert.rejects(() => registry.connect('openai', {}), (e) => e instanceof ConnectError && e.code === 'apiKey.required');
});

test('short key is refused', () => {
  assert.throws(() => validateInput(findProvider('openai'), { apiKey: 'short' }),
    (e) => e.code === 'apiKey.short' && e.field === 'apiKey');
});

test('key with whitespace is refused', () => {
  assert.throws(() => validateInput(findProvider('openai'), { apiKey: 'sk-abc def ghij' }),
    (e) => e.code === 'apiKey.whitespace');
});

test('plain http is refused for remote apiKey providers', () => {
  assert.throws(
    () => validateInput(findProvider('openai'), { apiKey: 'sk-1234567890', baseUrl: 'http://api.openai.com/v1' }),
    (e) => e.code === 'baseUrl.insecure' && e.field === 'baseUrl',
  );
});

test('plain http is allowed for loopback', () => {
  const cfg = validateInput(findProvider('openai'), { apiKey: 'sk-1234567890', baseUrl: 'http://localhost:8080/v1' });
  assert.equal(cfg.baseUrl, 'http://localhost:8080/v1');
});

test('trailing slashes are normalised', () => {
  assert.equal(parseBaseUrl('https://api.example.com/v1///'), 'https://api.example.com/v1');
});

test('garbage url is refused', () => {
  assert.throws(() => parseBaseUrl('not a url'), (e) => e.code === 'baseUrl.invalid');
});

test('local provider needs only a url', () => {
  const cfg = validateInput(findProvider('ollama'), { baseUrl: 'http://127.0.0.1:11434' });
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(cfg.apiKey, undefined);
});

// --- probe behaviour -----------------------------------------------------

test('failed probe stores no secret and marks the provider as errored', async () => {
  const failing = async () => { throw new ConnectError('probe.unauthorized', 'The provider rejected that key'); };
  const { secrets, registry } = setup(failing);
  await assert.rejects(() => registry.connect('openai', { apiKey: 'sk-1234567890' }), /rejected/);
  assert.equal(await secrets.get('provider:openai'), null);
  const p = byId(registry.list(), 'openai');
  assert.equal(p.status, 'error');
  assert.equal(p.maskedKey, '');
  assert.match(p.lastError, /rejected/);
});

test('unknown provider id is refused', async () => {
  const { registry } = setup();
  await assert.rejects(() => registry.connect('nope', { apiKey: 'sk-1234567890' }), (e) => e.code === 'provider.unknown');
});

test('an oauth provider takes no typed key', async () => {
  const { registry } = setup();
  // A sign-in provider is connected by a token from the device flow, so the
  // connect form must not ask for a secret.
  const provider = findProvider('opencode-go');
  assert.equal(provider.kind, 'oauth');
  assert.deepEqual(validateInput(provider, {}), { baseUrl: provider.oauth.baseUrl });
  const listed = (await registry.list()).find((p) => p.id === 'opencode-go');
  assert.equal(listed.kind, 'oauth');
});

test('a provider that signs in can be connected with a token', async () => {
  const { secrets, registry } = setup();
  const result = await registry.connectWithToken('opencode-go', 'gho_token_value');
  assert.equal(result.status, 'connected');
  assert.equal(await secrets.get('provider:opencode-go'), 'gho_token_value');
  assert.ok(result.maskedKey.endsWith('alue'));
});

test('a provider that uses a key cannot be connected with a token', async () => {
  const { registry } = setup();
  await assert.rejects(
    () => registry.connectWithToken('openai', 'sk-1234567890'),
    (e) => e.code === 'oauth.notApplicable',
  );
});

// --- lifecycle -----------------------------------------------------------

test('reconnecting replaces the stored secret', async () => {
  const { secrets, registry } = setup();
  await registry.connect('openai', { apiKey: 'sk-first-1111' });
  await registry.connect('openai', { apiKey: 'sk-second-2222' });
  assert.equal(await secrets.get('provider:openai'), 'sk-second-2222');
});

test('disconnect clears the secret and resets state', async () => {
  const { secrets, registry } = setup();
  await registry.connect('openai', { apiKey: 'sk-1234567890' });
  const after = await registry.disconnect('openai');
  assert.equal(await secrets.get('provider:openai'), null);
  assert.equal(after.status, 'disconnected');
  assert.equal(after.maskedKey, '');
});

test('a provider starts disconnected with its default base url', () => {
  const { registry } = setup();
  const p = byId(registry.list(), 'openai');
  assert.equal(p.status, 'disconnected');
  assert.equal(p.baseUrl, 'https://api.openai.com/v1');
});
