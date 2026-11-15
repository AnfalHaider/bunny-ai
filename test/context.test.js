/**
 * The context window, and what happens when it fills up.
 *
 * The meter is only useful if something acts on it, so these check both: the
 * number a person sees, and the compaction that keeps a long chat working.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSessionStore } from '../src/server/sessions.js';

async function storeWith(limit) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-ctx-'));
  const store = createSessionStore({ dir, contextLimit: limit });
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('the meter counts characters as roughly four to a token', async () => {
  const { store, cleanup } = await storeWith(1000);
  const { id } = await store.create();
  await store.append(id, { role: 'user', content: 'x'.repeat(400) });

  const meter = store.context(await store.get(id));
  assert.equal(meter.used, 104); // 400 characters plus the per-message overhead
  assert.equal(meter.limit, 1000);
  assert.equal(meter.pct, 10);
  await cleanup();
});

test('a model with a known window sets the limit for that chat', async () => {
  const { store, cleanup } = await storeWith(200_000);
  const { id } = await store.create();
  await store.update(id, { contextLimit: 8000 });

  const meter = store.context(await store.get(id));
  assert.equal(meter.limit, 8000);
  await cleanup();
});

test('a chat that fills up is compacted before the next message', async () => {
  const { store, cleanup } = await storeWith(400);
  const { id } = await store.create();

  // Twelve long turns push the transcript past 80% of a small window.
  for (let i = 0; i < 12; i += 1) {
    await store.append(id, { role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(120) });
  }
  const before = store.context(await store.get(id));
  assert.ok(before.used > before.limit * 0.8, 'the fixture must fill the window');

  const result = await store.compactIfFull(id);
  assert.ok(result, 'compaction should have happened');
  assert.ok(result.after.used < before.used);

  // The conversation stays on screen; the summary is added after it, and only the
  // summary onwards is counted (and read by the model).
  const session = await store.get(id);
  assert.equal(session.messages.length, 13);
  assert.equal(session.messages.at(-1).kind, 'summary');
  assert.equal(session.messages[0].content, 'x'.repeat(120));
  assert.equal(store.context(session).messages, 13);
  // The covered turns are remembered, so nothing is silently thrown away.
  assert.equal(session.compactions.length, 1);
  assert.equal(session.compactions[0].coveredMessages, 12);
  await cleanup();
});

test('a chat with room left is left alone', async () => {
  const { store, cleanup } = await storeWith(200_000);
  const { id } = await store.create();
  for (let i = 0; i < 12; i += 1) {
    await store.append(id, { role: i % 2 ? 'assistant' : 'user', content: 'short' });
  }
  assert.equal(await store.compactIfFull(id), null);
  await cleanup();
});

test('a short chat is never compacted automatically', async () => {
  const { store, cleanup } = await storeWith(10);
  const { id } = await store.create();
  await store.append(id, { role: 'user', content: 'x'.repeat(200) });
  // One message cannot be summarised into something smaller and still be useful.
  assert.equal(await store.compactIfFull(id), null);
  await cleanup();
});
