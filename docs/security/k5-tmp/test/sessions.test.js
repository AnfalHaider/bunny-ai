import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSessionStore } from '../src/server/sessions.js';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-sessions-'));
  const store = createSessionStore({ dir });
  return { dir, store, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('a new session starts empty with a uuid and timestamps', async () => {
  const { store, cleanup } = await freshStore();
  const session = await store.create();
  assert.match(session.id, /^[a-f0-9-]{36}$/);
  assert.equal(session.title, 'New chat');
  assert.deepEqual(session.messages, []);
  assert.ok(session.createdAt);
  assert.ok(session.updatedAt);
  await cleanup();
});

test('a created session is readable and listed', async () => {
  const { store, cleanup } = await freshStore();
  const created = await store.create({ providerId: 'nvidia', model: 'meta/llama-3.1-8b' });
  const got = await store.get(created.id);
  assert.equal(got.model, 'meta/llama-3.1-8b');
  assert.equal(got.providerId, 'nvidia');

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
  assert.equal(list[0].messageCount, 0);
  await cleanup();
});

test('appending a user turn names the chat after it', async () => {
  const { store, cleanup } = await freshStore();
  const { id } = await store.create();
  const after = await store.append(id, { role: 'user', content: '  How do I stream tokens?  ' });
  assert.equal(after.title, 'How do I stream tokens?');

  // A second user turn must not rename the chat.
  const again = await store.append(id, { role: 'user', content: 'and then?' });
  assert.equal(again.title, 'How do I stream tokens?');
  await cleanup();
});

test('a very long first message is truncated to a usable title', async () => {
  const { store, cleanup } = await freshStore();
  const { id } = await store.create();
  const long = 'x'.repeat(200);
  const after = await store.append(id, { role: 'user', content: long });
  assert.equal(after.title.length, 60);
  await cleanup();
});

test('both turns survive a reload from disk', async () => {
  const { store, dir, cleanup } = await freshStore();
  const { id } = await store.create();
  await store.append(id, { role: 'user', content: 'hello' });
  await store.append(id, { role: 'assistant', content: 'hi there' });

  const reopened = createSessionStore({ dir });
  const session = await reopened.get(id);
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[1].content, 'hi there');
  assert.ok(session.messages[0].at);

  const list = await reopened.list();
  assert.equal(list[0].messageCount, 2);
  await cleanup();
});

test('update changes title, provider and model but never the transcript', async () => {
  const { store, cleanup } = await freshStore();
  const { id } = await store.create();
  await store.append(id, { role: 'user', content: 'keep me' });

  const updated = await store.update(id, { title: 'Renamed', providerId: 'openai', model: 'gpt-4o' });
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.providerId, 'openai');
  assert.equal(updated.model, 'gpt-4o');
  assert.equal(updated.messages.length, 1);

  const tidied = await store.update(id, { title: 'y'.repeat(400) });
  assert.equal(tidied.title.length, 120);
  await cleanup();
});

test('list is newest-first', async () => {
  const { store, cleanup } = await freshStore();
  const first = await store.create({ title: 'older' });
  await new Promise((r) => setTimeout(r, 5));
  const second = await store.create({ title: 'newer' });
  const list = await store.list();
  assert.deepEqual(new Set(list.map((s) => s.id)), new Set([first.id, second.id]));
  assert.equal(list[0].id, second.id);
  assert.equal(list[1].id, first.id);
  await cleanup();
});

test('remove deletes one session and leaves the rest', async () => {
  const { store, cleanup } = await freshStore();
  const a = await store.create();
  const b = await store.create();
  await store.remove(a.id);
  assert.equal(await store.get(a.id), null);
  assert.equal((await store.list()).length, 1);
  assert.ok(await store.get(b.id));

  // Removing something absent is quiet, not fatal.
  await store.remove(a.id);
  await cleanup();
});

test('a bad session id is refused before it touches the disk', async () => {
  const { store, cleanup } = await freshStore();
  // A lookup for garbage is simply "not found"; writes refuse loudly.
  assert.equal(await store.get('../../etc/passwd'), null);
  await assert.rejects(() => store.append('not-a-uuid', { role: 'user', content: 'x' }), /Invalid session id/);
  await assert.rejects(() => store.update('not-a-uuid', { title: 'x' }), /Invalid session id/);
  await assert.rejects(() => store.remove('not-a-uuid'), /Invalid session id/);
  await cleanup();
});

test('appending to a session that does not exist reports it', async () => {
  const { store, cleanup } = await freshStore();
  await assert.rejects(
    () => store.append('11111111-2222-3333-4444-555555555555', { role: 'user', content: 'x' }),
    /Session not found/,
  );
  await cleanup();
});

test('a corrupt session file is skipped instead of breaking the sidebar', async () => {
  const { store, dir, cleanup } = await freshStore();
  const good = await store.create({ title: 'fine' });
  await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8');

  const list = await store.list();
  assert.deepEqual(list.map((s) => s.id), [good.id]);
  const files = await readdir(dir);
  assert.ok(files.includes('broken.json'));
  await cleanup();
});

test('saving leaves no temp files behind', async () => {
  const { store, dir, cleanup } = await freshStore();
  const { id } = await store.create();
  await store.append(id, { role: 'user', content: 'hello' });
  await store.update(id, { title: 'ok' });
  const files = await readdir(dir);
  assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0);
  assert.equal(files.length, 1);
  await cleanup();
});
