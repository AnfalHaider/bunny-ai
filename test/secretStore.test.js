import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dpapiSecretStore } from '../src/providers/secretStore.js';
import { createProviderRegistry } from '../src/providers/connections.js';

const windows = process.platform === 'win32';

test('DPAPI round-trips a secret', { skip: !windows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  const store = dpapiSecretStore({ dir });
  const secret = 'sk-round-trip-abcdef123456';

  await store.set('provider:openai', secret);
  assert.equal(await store.get('provider:openai'), secret);

  await rm(dir, { recursive: true, force: true });
});

test('the file on disk never contains the plain secret', { skip: !windows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  const store = dpapiSecretStore({ dir });
  const secret = 'sk-should-never-appear-in-ciphertext-9999';

  await store.set('provider:openai', secret);
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const raw = await readFile(join(dir, files[0]), 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes(Buffer.from(secret).toString('base64')), false);

  await rm(dir, { recursive: true, force: true });
});

test('missing secret reads as null', { skip: !windows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  const store = dpapiSecretStore({ dir });
  assert.equal(await store.get('provider:nobody'), null);
  await rm(dir, { recursive: true, force: true });
});

test('delete removes the secret and is safe to repeat', { skip: !windows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  const store = dpapiSecretStore({ dir });
  await store.set('provider:openai', 'sk-delete-me-123456');
  await store.delete('provider:openai');
  assert.equal(await store.get('provider:openai'), null);
  await store.delete('provider:openai');
  await rm(dir, { recursive: true, force: true });
});

test('keys with path separators cannot escape the directory', { skip: !windows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  const store = dpapiSecretStore({ dir });
  await store.set('../../evil', 'sk-traversal-123456');
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{32}\.secret$/);
  await rm(dir, { recursive: true, force: true });
});

test('the registry writes through to DPAPI and lists only the masked key', { skip: !windows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  const secrets = dpapiSecretStore({ dir });
  const registry = createProviderRegistry({ secrets, probe: async () => ({ ok: true }) });
  const secret = 'sk-integration-abcdef4321';

  const connected = await registry.connect('openai', { apiKey: secret });
  assert.equal(connected.status, 'connected');
  assert.equal(connected.maskedKey, 'sk-…4321');
  assert.equal(await secrets.get('provider:openai'), secret);
  assert.equal(JSON.stringify(registry.list()).includes(secret), false);

  await registry.disconnect('openai');
  assert.equal(await secrets.get('provider:openai'), null);
  await rm(dir, { recursive: true, force: true });
});

test('S-6 (v0.1.10): a saved cipher that is not plain base64 is never put into a script, and PowerShell is called by its full path', { skip: !windows }, async () => {
  const { writeFile, readdir: list } = await import('node:fs/promises');
  const { isCipher, PS } = await import('../src/providers/secretStore.js');
  assert.ok(/^[A-Za-z]:[\\/].*System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i.test(PS), PS);
  assert.ok(isCipher('QUJD+/=='));
  for (const bad of ["abc'; Start-Process calc; '", 'a b', '', 'abc$(x)', `${'A'.repeat(70000)}`, null, 12]) assert.equal(isCipher(bad), false, String(bad).slice(0, 30));
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  try {
    const store = dpapiSecretStore({ dir });
    await store.set('provider:x', 'sk-real-0000');
    const [file] = await list(dir);
    await writeFile(join(dir, file), JSON.stringify({ name: 'provider:x', cipher: "AAAA'; Set-Content $env:TEMP\s6-proof.txt 'ran'; '" }));
    assert.equal(await store.get('provider:x'), null, 'the planted file reads as no secret');
    await writeFile(join(dir, file), 'not json');
    assert.equal(await store.get('provider:x'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
