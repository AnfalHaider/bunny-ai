import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPcActivity, ACTIVITY_MAX_ENTRIES, ACTIVITY_MAX_AGE_MS, LABEL_CHARS } from '../src/server/pcActivity.js';

// SEARCH-PC SP-6: what was looked at, by name; kept across a restart without being written over; no query beyond 40 characters, no label in a private chat, never file text.
async function tmp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-pca-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'pcsearch-activity.json');
}

test('entries are saved and survive a restart; a new entry after the restart is added to the old ones, never written over them', async (t) => {
  const file = await tmp(t);
  const first = createPcActivity({ file });
  first.log({ who: 'window', kind: 'search', results: 3, label: 'tax return' });
  first.log({ who: 'bar', kind: 'read', files: [{ name: 'tax.txt', folder: 'C:\docs' }] });
  await first.flush();
  const second = createPcActivity({ file });
  second.log({ who: 'Kitchen laptop', kind: 'search', results: 0 }); // written before the saved file has been read
  const list = await second.list();
  assert.deepEqual(list.map((e) => `${e.who}:${e.kind}`), ['Kitchen laptop:search', 'bar:read', 'window:search'], 'newest first, all three');
  await second.flush();
  assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 3, 'the file holds all of them');
});

test('no query beyond a 40-character label, no label at all when none is given, and never file text', async (t) => {
  const file = await tmp(t);
  const a = createPcActivity({ file });
  a.log({ who: 'window', kind: 'search', results: 2, label: 'x'.repeat(200), query: 'SELECT secret', text: 'file text' });
  a.log({ who: 'window', kind: 'search', results: 2 });
  a.log({ who: 'window', kind: 'read', files: [{ name: 'a.txt', folder: 'C:\d', text: 'FILE TEXT', content: 'more' }], text: 'file text' });
  await a.flush();
  const saved = await readFile(file, 'utf8');
  assert.ok(!/SELECT|file text|FILE TEXT|more/.test(saved));
  const [read, bare, labelled] = await a.list();
  assert.equal(labelled.label.length, LABEL_CHARS);
  assert.equal('label' in bare, false);
  assert.deepEqual(Object.keys(read.files[0]).sort(), ['folder', 'name']);
});

test('old entries are pruned: 500 at most, and nothing older than 30 days', async (t) => {
  const file = await tmp(t);
  let now = Date.now();
  const a = createPcActivity({ file, now: () => now });
  for (let i = 0; i < ACTIVITY_MAX_ENTRIES + 30; i += 1) a.log({ who: 'window', kind: 'search', results: i });
  assert.equal((await a.list()).length, ACTIVITY_MAX_ENTRIES);
  assert.equal((await a.list())[0].results, ACTIVITY_MAX_ENTRIES + 29, 'the newest kept');
  now += ACTIVITY_MAX_AGE_MS + 1000;
  assert.equal((await a.list()).length, 0, 'older than 30 days: gone');
  await a.flush(); // the first instance's own save must be finished before the file is written by hand (a write still queued would land after it)
  await writeFile(file, JSON.stringify([{ at: new Date(now - ACTIVITY_MAX_AGE_MS - 5000).toISOString(), who: 'window', kind: 'search', results: 1 }]));
  assert.equal((await createPcActivity({ file, now: () => now }).list()).length, 0, 'and not read back from the saved file either');
});

test('a read logs at most 3 files, and a file name with a line break stays on one line', async () => {
  const a = createPcActivity({});
  a.log({ who: 'window', kind: 'read', files: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}\nINJECTED`, folder: 'C:\d' })) });
  const [e] = await a.list();
  assert.equal(e.files.length, 3);
  assert.ok(e.files.every((f) => !/[\r\n]/.test(f.name)));
});
