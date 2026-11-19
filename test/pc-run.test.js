import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPcSearch, runPowerShell, MAX_ROWS, MAX_OUTPUT_BYTES, SNIPPET_CHARS } from '../src/server/pcSearch.js';
import { powershellPath, taskkillPath } from '../src/server/safeExec.js';
import { fakeRunner } from './support/pc-fake-index.mjs';

// SEARCH-PC SP-7: time, size and one-at-a-time limits; what "not available" looks like. No real index, no PowerShell.
const windows = process.platform === 'win32';
const line = (i, extra = {}) => JSON.stringify({ p: `C:\\docs\\file ${i}.txt`, n: `file ${i}.txt`, m: '2025-03-01 10:00:00', s: 10, a: 'text', ...extra });

function stuckChild(onKill) {
  const calls = [];
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), pid: 777, kill() { calls.push('child.kill'); } });
  const execFileImpl = (file, args) => {
    calls.push([file, ...(args ?? [])]);
    if (file === taskkillPath()) { onKill?.(child); }
    return child;
  };
  return { child, execFileImpl, calls };
}

test('a search that does not answer in 10 s (here 50 ms) kills the whole process tree with taskkill /T /F and says so', { skip: !windows && 'Windows' }, async () => {
  const { execFileImpl, calls, child } = stuckChild((c) => setTimeout(() => c.emit('close', 1), 1));
  const out = await runPowerShell('SELECT 1', { timeoutMs: 50, execFileImpl });
  assert.equal(out.timedOut, true);
  const kill = calls.find((c) => Array.isArray(c) && c[0] === taskkillPath());
  assert.deepEqual(kill, [taskkillPath(), '/PID', String(child.pid), '/T', '/F']);
  const search = createPcSearch({ run: async () => out });
  assert.deepEqual(await search.search({ terms: ['a'] }), { state: 'timeout', message: 'Windows Search did not answer in time.' });
});

test('more than 1 MB of output is cut and the process tree is killed', { skip: !windows && 'Windows' }, async () => {
  const { execFileImpl, calls, child } = stuckChild((c) => setTimeout(() => c.emit('close', 1), 1));
  const pending = runPowerShell('SELECT 1', { timeoutMs: 5000, execFileImpl });
  await new Promise((r) => setTimeout(r, 5));
  child.stdout.emit('data', 'x'.repeat(MAX_OUTPUT_BYTES + 10));
  const out = await pending;
  assert.equal(out.tooBig, true);
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === taskkillPath()));
  void powershellPath;
});

test('50 rows at most, 200 characters of snippet at most, and a row without a path is dropped', async () => {
  const lines = [line(0, { p: '' }), ...Array.from({ length: 80 }, (_, i) => line(i + 1, { a: 'y'.repeat(500) })), '{"done":true}'];
  const r = await createPcSearch({ run: async () => ({ lines, timedOut: false, tooBig: false }) }).search({ terms: ['file'] });
  assert.equal(r.state, 'ok');
  assert.equal(r.rows.length, MAX_ROWS);
  assert.equal(r.truncated, true);
  assert.ok(r.rows.every((x) => x.snippet.length === SNIPPET_CHARS));
});

test('"not available" and "nothing found" are states, never a scan of the disk', async () => {
  let runs = 0;
  const unavailable = createPcSearch({ run: async () => { runs += 1; return { lines: ['{"error":"service"}'], timedOut: false, tooBig: false }; } });
  assert.deepEqual(await unavailable.search({ terms: ['a'] }), { state: 'unavailable', message: 'Windows Search is not available.' });
  assert.equal(runs, 1, 'one query to the index and nothing else');
  const provider = createPcSearch({ run: async () => ({ lines: ['{"error":"InvalidOperationException"}'], timedOut: false, tooBig: false }) });
  assert.equal((await provider.search({ terms: ['a'] })).state, 'unavailable');
  const none = createPcSearch({ run: async () => ({ lines: ['{"done":true}'], timedOut: false, tooBig: false }) });
  assert.equal((await none.search({ terms: ['a'] })).state, 'nothing');
  assert.equal((await none.search({ terms: ['%%'] })).state, 'nothing', 'no usable words: no search at all');
  assert.equal((await none.search({ terms: ['a'], kind: 'nope' })).state, 'bad');
});

test('one search at a time per chat or bar, and at most 5 in a reply: the sixth is refused', async () => {
  const releases = [];
  const slow = createPcSearch({ run: () => new Promise((resolve) => { releases.push(() => resolve({ lines: ['{"done":true}'], timedOut: false, tooBig: false })); }) });
  const first = slow.search({ terms: ['a'] }, { gate: 'chat-1' });
  assert.equal((await slow.search({ terms: ['b'] }, { gate: 'chat-1' })).state, 'busy');
  const other = slow.search({ terms: ['c'] }, { gate: 'bar' });
  assert.equal((await Promise.race([other.then(() => 'finished'), new Promise((r) => setTimeout(() => r('waiting'), 20))])), 'waiting', 'another gate is not blocked by the first');
  releases.forEach((r) => r()); await first; await other;
  const turn = { searches: 0 };
  const ok = createPcSearch({ run: fakeRunner([{ path: 'C:\\a.txt', name: 'a.txt' }]) });
  for (let i = 0; i < 5; i += 1) assert.equal((await ok.search({ terms: ['a'] }, { turn })).state, 'ok');
  const sixth = await ok.search({ terms: ['a'] }, { turn });
  assert.equal(sixth.state, 'limit');
  assert.match(sixth.message, /5 times/);
});
