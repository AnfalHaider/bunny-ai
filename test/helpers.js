/**
 * Shared harness for route-level tests.
 *
 * Each test gets its own data directory, a memory secret store and a stubbed
 * network, so nothing here can read or write the real profile.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server/app.js';

// F13: Confine commands is on in Auto when a person never chose; the suites that run commands in Auto answer no label card, so they start with it off (the suites about confinement set their own)
process.env.BUNNY_CONFINE_DEFAULT ??= 'off';
import { memorySecretStore } from '../src/providers/connections.js';

export const MODELS = [
  { id: 'test-model-1', displayName: 'Test One', ownedBy: 'test', contextLength: null },
  { id: 'test-model-2', displayName: 'Test Two', ownedBy: 'test', contextLength: null },
];

export async function startApp(t, overrides = {}) {
  const dataDir = overrides.dataDir ?? (await mkdtemp(join(tmpdir(), 'bunny-route-')));
  const options = {
    dataDir,
    fake: true,
    secretStore: memorySecretStore(),
    probe: async () => ({ ok: true, keyVerified: true }),
    discover: async () => MODELS,
    // S-1: these suites call the API with no browser; the guard has its own suite (request-guard.test.js).
    localGuard: false,
    ...overrides,
  };
  // `null` means "use the real one" rather than the stub.
  if (options.probe === null) delete options.probe;
  if (options.discover === null) delete options.discover;

  const app = await createApp(options);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => {
      app.server.close(() => resolve());
      app.server.closeAllConnections?.();
    });
    if (overrides.dataDir === undefined) await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); // a late write by the app must not fail the test that already passed (ENOTEMPTY on Windows)
  });

  return { app, base, dataDir };
}

export const json = async (base, path, init) => {
  const res = await fetch(base + path, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
};

export const post = (base, path, body) =>
  json(base, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const patch = (base, path, body) =>
  json(base, path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const put = (base, path, body) =>
  json(base, path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const del = (base, path) => json(base, path, { method: 'DELETE' });

/** Connect a provider and return its first model id, for chat tests. */
export async function connectProvider(base, id = 'anthropic') {
  const res = await post(base, `/api/providers/${id}/connect`, { apiKey: 'sk-test-000000000000' });
  if (res.status !== 200) throw new Error(`connect failed: ${JSON.stringify(res.body)}`);
  const models = await json(base, `/api/providers/${id}/models`);
  return models.body[0]?.id ?? null;
}
