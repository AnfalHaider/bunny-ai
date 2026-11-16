/** T-3: is this computer online? The probe is bare, parallel, limited to a few seconds, and never throws. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probeNetwork, PROBE_ENDPOINTS } from '../src/server/network.js';
import { startApp, json } from './helpers.js';

const never = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('T3-14: every endpoint failing means offline, in about the limit', async () => {
  const t0 = Date.now();
  const down = async () => { throw new Error('ENOTFOUND'); };
  assert.deepEqual(await probeNetwork({ fetchImpl: down }), { online: false });
  assert.deepEqual(await probeNetwork({ fetchImpl: never, timeoutMs: 200 }), { online: false });
  assert.ok(Date.now() - t0 < 2000);
});

test('T3-14: one answer from any endpoint means online, and a slow one does not hold the answer', async () => {
  const t0 = Date.now();
  const fetchImpl = (url, init) => (String(url).includes('apple') ? Promise.resolve({ status: 200 }) : never(url, init));
  assert.deepEqual(await probeNetwork({ fetchImpl, timeoutMs: 5000 }), { online: true });
  assert.ok(Date.now() - t0 < 1000, 'answered as soon as one endpoint did');
  assert.deepEqual(await probeNetwork({ fetchImpl: async () => ({ status: 503 }) }), { online: true }, 'an error page is still an answer');
});

test('T3-14: a malformed or non-https entry is one failed probe, never an exception', async () => {
  const ok = async () => ({ status: 204 });
  assert.deepEqual(await probeNetwork({ fetchImpl: ok, endpoints: ['not a url', 42, null, 'http://insecure.example', 'https://good.example/'] }), { online: true });
  assert.deepEqual(await probeNetwork({ fetchImpl: ok, endpoints: ['not a url', 42, null, 'http://insecure.example'] }), { online: false });
  assert.deepEqual(await probeNetwork({ fetchImpl: ok, endpoints: 'nope' }), { online: false });
  assert.deepEqual(await probeNetwork({ fetchImpl: ok, endpoints: [] }), { online: false });
});

test('the probe sends a bare request: no body, no cookies, no custom headers', async () => {
  const seen = [];
  await probeNetwork({ fetchImpl: async (url, init) => { seen.push(init); return { status: 204 }; } });
  assert.equal(seen.length, PROBE_ENDPOINTS.length);
  for (const init of seen) {
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers, undefined);
    assert.equal(init.credentials, 'omit');
  }
});

test('GET /api/network answers through the app, with an injected probe', async (t) => {
  const { base } = await startApp(t, { networkProbe: async () => ({ online: false }) });
  assert.deepEqual((await json(base, '/api/network')).body, { online: false });
  const second = await startApp(t, { networkProbe: async () => ({ online: true }) });
  assert.deepEqual((await json(second.base, '/api/network')).body, { online: true });
});
