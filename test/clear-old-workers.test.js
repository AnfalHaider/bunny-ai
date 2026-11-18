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
