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
  const files = (await readdir(dir)).filter((f) => f.endsWith('.secret'));
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
  const files = (await readdir(dir)).filter((f) => f.endsWith('.secret'));
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
    const [file] = (await list(dir)).filter((f) => f.endsWith('.secret'));
    await writeFile(join(dir, file), JSON.stringify({ name: 'provider:x', cipher: "AAAA'; Set-Content $env:TEMP\s6-proof.txt 'ran'; '" }));
    assert.equal(await store.get('provider:x'), null, 'the planted file reads as no secret');
    await writeFile(join(dir, file), 'not json');
    assert.equal(await store.get('provider:x'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('S-3 (v0.1.10): secrets are protected with a per-install entropy value: a bare Unprotect of a copied file fails, and a secret saved by an older build still reads and is re-saved with it', { skip: !windows }, async () => {
  const { writeFile, readFile: read } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { PS } = await import('../src/providers/secretStore.js');
  const dir = await mkdtemp(join(tmpdir(), 'bunny-secrets-'));
  try {
    const store = dpapiSecretStore({ dir });
    await store.set('provider:e', 'sk-entropy-0000');
    const file = (await readdir(dir)).find((f) => f.endsWith('.secret'));
    const saved = JSON.parse(await read(join(dir, file), 'utf8'));
    assert.equal(saved.v, 2);
    assert.ok((await readdir(dir)).includes('entropy.key'));
    assert.doesNotMatch(await read(join(dir, file), 'utf8'), /entropy/i, 'the entropy is not in the secret file');
    const bare = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $e=[Convert]::FromBase64String('${saved.cipher}'); [Security.Cryptography.ProtectedData]::Unprotect($e,$null,'CurrentUser') | Out-Null; 'READ'`;
    const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', bare], { encoding: 'utf8' });
    assert.doesNotMatch(r.stdout, /READ/, 'the two calls a generic stealer would make do not read it');
    assert.equal(await store.get('provider:e'), 'sk-entropy-0000');
    // an older build's file: no entropy, version 1
    const legacy = `Add-Type -AssemblyName System.Security; $p=[Text.Encoding]::UTF8.GetBytes('sk-legacy-1111'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($p,$null,'CurrentUser'))`;
    const old = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', legacy], { encoding: 'utf8' }).stdout.trim();
    const { createHash } = await import('node:crypto');
    const legacyFile = join(dir, `${createHash('sha256').update('provider:old').digest('hex').slice(0, 32)}.secret`);
    await writeFile(legacyFile, JSON.stringify({ name: 'provider:old', cipher: old }));
    assert.equal(await store.get('provider:old'), 'sk-legacy-1111', 'an older secret still reads');
    assert.equal(JSON.parse(await read(legacyFile, 'utf8')).v, 2, 'and is re-saved with the entropy');
    assert.equal(await store.get('provider:old'), 'sk-legacy-1111');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
