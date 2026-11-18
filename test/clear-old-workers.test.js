import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearOldWorkersOnce } from '../electron/clear-old-workers.js';

test('the old service workers and their caches are cleared once, on the first start only', async () => {
  const calls = [];
  const session = { clearStorageData: async (o) => { calls.push(o); } };
  const files = new Set();
  const fs = { existsSync: (f) => files.has(f), writeFileSync: (f) => files.add(f) };
  assert.equal(await clearOldWorkersOnce({ session, flagFile: 'flag', fs }), true);
  assert.deepEqual(calls, [{ storages: ['serviceworkers', 'cachestorage'] }]);
  assert.equal(await clearOldWorkersOnce({ session, flagFile: 'flag', fs }), false);
  assert.equal(calls.length, 1, 'not again');
});

test('a failed clear is not marked done, so the next start tries again', async () => {
  const files = new Set();
  const fs = { existsSync: (f) => files.has(f), writeFileSync: (f) => files.add(f) };
  assert.equal(await clearOldWorkersOnce({ session: { clearStorageData: async () => { throw new Error('x'); } }, flagFile: 'f', fs }), false);
  assert.equal(files.size, 0);
});

test('a clear that never finishes does not hold anything up: it gives up at the timeout and the flag stays unset', async () => {
  const files = new Set();
  const fs = { existsSync: (f) => files.has(f), writeFileSync: (f) => files.add(f) };
  const started = Date.now();
  const ran = await clearOldWorkersOnce({ session: { clearStorageData: () => new Promise(() => {}) }, flagFile: 'f', fs, timeoutMs: 50 });
  assert.equal(ran, false);
  assert.ok(Date.now() - started < 1000, 'returned within the timeout');
  assert.equal(files.size, 0, 'no flag, so the next start retries');
});
