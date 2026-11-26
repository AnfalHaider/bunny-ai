/** LOCAL-MODELS T1, T2, T3: every model call is counted while it runs, a stopped Bunny local gives LM-18's sentence and starts nothing, and a call for another local model is refused. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { trackLocalCalls } from '../src/server/localCalls.js';

function service({ base = 'http://127.0.0.1:50000/v1', running = 'qwen3-4b' } = {}) {
  const log = [];
  return { log, ownsAddress: (u) => Boolean(base) && String(u).startsWith(base), runningModelId: () => running, beginCall: () => { log.push('begin'); return () => log.push('end'); }, touch: () => log.push('touch') };
}
const chunks = (list) => async function* () { for (const c of list) yield c; };
const all = async (g) => { const out = []; for await (const c of g) out.push(c); return out; };

test('T1: a call to the running local model is counted from its first chunk to its end, touching the server on every chunk, even when the reader stops early', async () => {
  const lm = service();
  const call = trackLocalCalls({ streamChat: chunks(['a', 'b', 'c']), localModels: lm });
  assert.deepEqual(await all(call({ baseUrl: 'http://127.0.0.1:50000/v1', model: 'qwen3-4b' })), ['a', 'b', 'c']);
  assert.deepEqual(lm.log, ['begin', 'touch', 'touch', 'touch', 'end']);
  lm.log.length = 0;
  for await (const c of call({ baseUrl: 'http://127.0.0.1:50000/v1', model: 'qwen3-4b' })) { if (c === 'a') break; } // the reader gives up: the call still ends
  assert.equal(lm.log.at(-1), 'end');
  lm.log.length = 0;
  const boom = trackLocalCalls({ streamChat: async function* () { yield 'x'; throw new Error('upstream failed'); }, localModels: lm });
  await assert.rejects(all(boom({ baseUrl: 'http://127.0.0.1:50000/v1', model: 'qwen3-4b' })), /upstream failed/);
  assert.equal(lm.log.at(-1), 'end', 'a failed call ends too');
});

test('T2: a scheduled run, a helper or another chat that finds Bunny local stopped (no address) gets LM-18\'s sentence and nothing starts', async () => {
  const lm = service({ base: '' });
  let called = false;
  const call = trackLocalCalls({ streamChat: async function* () { called = true; yield 'x'; }, localModels: lm });
  await assert.rejects(all(call({ baseUrl: '', model: 'qwen3-4b' })), (e) => e.code === 'local.notRunning' && e.message === "Bunny local was stopped, so this run didn't use it.");
  assert.equal(called, false);
  assert.deepEqual(lm.log, []);
});

test('T3: a helper that names another local model than the one that runs is refused, not answered by the running model', async () => {
  const lm = service();
  let called = false;
  const call = trackLocalCalls({ streamChat: async function* () { called = true; yield 'x'; }, localModels: lm });
  await assert.rejects(all(call({ baseUrl: 'http://127.0.0.1:50000/v1', model: 'granite-4.1-3b' })), (e) => e.code === 'local.notRunning' && /running another model/.test(e.message));
  assert.equal(called, false);
});

test('a call to any other provider, and a test-mode call, pass through untouched and are not counted', async () => {
  const lm = service();
  const call = trackLocalCalls({ streamChat: chunks(['a']), localModels: lm });
  assert.deepEqual(await all(call({ baseUrl: 'https://api.example.com/v1', model: 'x' })), ['a']);
  assert.deepEqual(await all(call({ baseUrl: '', model: 'x', fake: true })), ['a']);
  assert.deepEqual(lm.log, []);
});
