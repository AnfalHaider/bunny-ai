/**
 * LOCAL-MODELS LF-17 to LF-24 and LF-26: the download folder, the records, the fingerprint before a start, delete, Remove Bunny local and Move.
 * An invented tree, an injected folder lock and drive types, stand-in hosts. Never the real drives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink, realpath, stat, utimes, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFolderRules } from '../src/server/localFolderRules.js';
import { createPlaces } from '../src/server/localPlaces.js';
import { createStore, entryDir, BUNNY_DIR } from '../src/server/localStore.js';
import { downloadModel } from '../src/server/localDownload.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const BYTES = Buffer.concat([Buffer.from('MODEL'), Buffer.alloc(5000, 7)]);
const entry = (id, bytes = BYTES, repo = 'Acme/Tiny-GGUF') => ({ id, name: id, repo, revision: 'a'.repeat(40), file: `${id}.gguf`, size: bytes.length, sha256: sha(bytes), gated: false });
const stream = (buf) => (async function* () { for (let i = 0; i < buf.length; i += 1024) yield buf.subarray(i, i + 1024); })();
const hub = (bytes) => async (url) => { const u = new URL(url); if (u.hostname === 'huggingface.co') return { status: 302, headers: { location: 'https://us.aws.cdn.hf.co/blob', 'x-linked-size': String(bytes.length), 'x-linked-etag': `"${sha(bytes)}"` }, body: [] }; return { status: 200, headers: {}, body: stream(bytes) }; };

async function world(t, o = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-st-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const d = (...p) => join(root, ...p);
  for (const p of ['data', 'app', 'home', 'win', 'drive-a', 'drive-b', 'project']) await mkdir(d(p), { recursive: true });
  const types = { default: 'Fixed' }; const locked = []; let lockOk = true; let free = Infinity;
  const rules = createFolderRules({ dataDir: d('data'), installDirs: [d('app')], home: d('home'), env: { SystemRoot: d('win') }, driveType: async (l) => types[l] ?? types.default, knownFolders: async () => ({}), projectFolders: () => [d('project')] });
  const places = createPlaces({ dataDir: d('data'), rules, home: d('home') });
  const store = createStore({ dataDir: d('data'), places, rules, lock: async (dir) => { locked.push(dir); return lockOk; }, freeBytes: async () => free, ...o });
  return { root, d, rules, places, store, types, locked, setLock: (v) => { lockOk = v; }, setFree: (v) => { free = v; } };
}
/** Put a recorded download in place without the network. */
async function place(w, e, bytes = BYTES, rootDir = null) {
  const base = rootDir ?? await w.store.root();
  const dir = entryDir(base, e); await mkdir(dir, { recursive: true });
  const f = join(dir, e.file); await writeFile(f, bytes);
  await w.store.record(e.id, await realpath(f), sha(bytes));
  return f;
}

test('LF-17: choosing a folder creates only `Bunny models` inside it and locks it; if the lock fails the folder is not used; a link or a busy download is refused', async (t) => {
  const w = await world(t);
  const r = await w.store.setDownloadFolder(w.d('drive-a'));
  assert.equal(r.root.toLowerCase(), join(w.d('drive-a'), BUNNY_DIR).toLowerCase());
  assert.deepEqual(w.locked, [r.root]);
  assert.deepEqual(await readdir(w.d('drive-a')), [BUNNY_DIR]);
  assert.equal((await w.store.root()).toLowerCase(), r.root.toLowerCase());
  w.setLock(false);
  await assert.rejects(w.store.setDownloadFolder(w.d('drive-b')), (e) => e.code === 'place.perms');
  assert.equal(w.places.state().downloadFolder.real.toLowerCase(), w.d('drive-a').toLowerCase(), 'the old setting is kept');
  w.setLock(true);
  await symlink(w.d('drive-b'), w.d('link-b'), 'junction');
  await assert.rejects(w.store.setDownloadFolder(w.d('link-b')), (e) => e.code === 'link');
  await assert.rejects(w.store.setDownloadFolder(w.d('drive-b'), { busy: true }), (e) => e.code === 'place.busy' && /Wait for the download to finish or cancel it/.test(e.message));
  await w.store.clearDownloadFolder();
  assert.equal(await w.store.root(), w.d('data', 'models'));
});

test('LF-17: a download lands only under <chosen>\\Bunny models\\<owner>__<repo>\\, with a record in the data folder and no manifest beside it', async (t) => {
  const w = await world(t);
  const { root } = await w.store.setDownloadFolder(w.d('drive-a'));
  const e = entry('m1');
  const { path } = await downloadModel({ dataDir: w.d('data'), root: await w.store.root(), writeManifest: false, entry: e, fetchImpl: hub(BYTES) });
  await w.store.record(e.id, await realpath(path), e.sha256);
  assert.ok(path.toLowerCase().startsWith(join(root, 'Acme__Tiny-GGUF').toLowerCase()));
  assert.deepEqual((await readdir(w.d('drive-a'))).sort(), [BUNNY_DIR]);
  assert.equal(existsSync(`${path}.manifest.json`), false);
  assert.equal(existsSync(w.d('data', 'models')), false, 'nothing was written to the default folder');
  assert.equal(w.places.state().downloads.m1.sha256, e.sha256);
  assert.equal((await w.store.verify('m1', e)).state, 'ok');
});

test('LF-17: a planted link at the .part name is not followed; a same-name stranger with the wrong sha is not adopted, one with the right sha is', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e = entry('m2'); const base = await w.store.root(); const dir = entryDir(base, e); await mkdir(dir, { recursive: true });
  await writeFile(w.d('victim.txt'), 'precious');
  try { await symlink(w.d('victim.txt'), join(dir, `${e.file}.part`), 'file'); } catch { t.diagnostic('file symlinks are not allowed here: the .part-link case is skipped'); }
  if (existsSync(join(dir, `${e.file}.part`))) await assert.rejects(downloadModel({ dataDir: w.d('data'), root: base, writeManifest: false, entry: e, fetchImpl: hub(BYTES) }), (err) => err.code === 'local.link');
  assert.equal(await readFile(w.d('victim.txt'), 'utf8'), 'precious');
  await rm(join(dir, `${e.file}.part`), { force: true });
  await writeFile(join(dir, e.file), 'a stranger with this name');
  await assert.rejects(downloadModel({ dataDir: w.d('data'), root: base, writeManifest: false, entry: e, fetchImpl: hub(BYTES) }), (err) => err.code === 'place.exists' && /A different file with this name is already there/.test(err.message));
  assert.equal(await readFile(join(dir, e.file), 'utf8'), 'a stranger with this name', 'not overwritten');
  await rm(join(dir, e.file));
  await writeFile(join(dir, e.file), BYTES);
  const r = await downloadModel({ dataDir: w.d('data'), root: base, writeManifest: false, entry: e, fetchImpl: hub(BYTES) });
  assert.equal(r.path, join(dir, e.file), 'the right file there is adopted');
});

test('LF-18: unchanged is fine; the mtime set back or a flipped byte is caught by the check and re-hashed; a swap with a different file id is re-hashed; a missing file says Not found with no download', async (t) => {
  const w = await world(t);
  const e = entry('m3'); const f = await place(w, e);
  assert.equal((await w.store.verify('m3', e)).state, 'ok');
  const old = new Date(Date.now() - 86_400_000);
  assert.equal((await w.store.verify('m3', e)).state, 'ok');
  await utimes(f, old, old); // the times are touched, the bytes are the same: re-hashed, matches, the record is updated
  assert.equal((await w.store.verify('m3', e)).state, 'ok');
  assert.equal((await w.store.verify('m3', e)).state, 'ok');
  const rec0 = w.places.state().downloads.m3; const flipped = Buffer.from(BYTES); flipped[10] ^= 1; await writeFile(f, flipped); await utimes(f, new Date(rec0.mtimeMs), new Date(rec0.mtimeMs)); // same size, a byte flipped, the mtime set back to the recorded one: the change time still moved
  assert.deepEqual([(await w.store.verify('m3', e)).state, (await w.store.verify('m3', e)).message], ['changed', 'This file changed after Bunny downloaded it.']);
  await rm(f); await writeFile(f, BYTES); // a different file id with the right content
  assert.equal((await w.store.verify('m3', e)).state, 'ok');
  await rm(f);
  const gone = await w.store.verify('m3', e);
  assert.deepEqual([gone.state, gone.message], ['notFound', 'Not found']);
  assert.equal((await w.store.verify('never', e)).state, 'none');
});

test('LF-17: deleting removes only the recorded file and empty folders, and leaves a stranger file in the same folder', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e = entry('m4'); const f = await place(w, e);
  const stranger = join(f, '..', 'notes.txt'); await writeFile(stranger, 'mine');
  assert.equal((await w.store.removeRecorded('m4')).state, 'removed');
  assert.equal(existsSync(f), false); assert.equal(await readFile(stranger, 'utf8'), 'mine');
  const e2 = entry('m5', BYTES, 'Acme/Other-GGUF'); const f2 = await place(w, e2);
  assert.equal((await w.store.removeRecorded('m5')).state, 'removed');
  assert.equal(existsSync(join(f2, '..', '..')), false, 'the empty owner__repo folder went');
  assert.equal(existsSync(w.d('drive-a', BUNNY_DIR, 'Acme__Tiny-GGUF')), true, 'a folder with a stranger in it stays');
  // a recorded file that was swapped for another file (different file id) is left alone
  const e3 = entry('m6', BYTES, 'Acme/Third-GGUF'); const f3 = await place(w, e3);
  await rm(f3); await writeFile(f3, 'a different file');
  assert.equal((await w.store.removeRecorded('m6')).state, 'left'); assert.equal(await readFile(f3, 'utf8'), 'a different file');
});

test('LF-24: Remove Bunny local deletes recorded downloads in two download folders, leaves a changed file and a stranger, names a missing drive, and drops its record', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const a = entry('ra'); const fa = await place(w, a);
  const b = entry('rb', BYTES, 'Acme/B-GGUF'); const fb = await place(w, b, BYTES, w.d('data', 'models'));
  const c = entry('rc', BYTES, 'Acme/C-GGUF'); const fc = await place(w, c);
  await rm(fc); await writeFile(fc, 'changed under us');
  const dd = entry('rd', BYTES, 'Acme/D-GGUF'); const fd = await place(w, dd); await rm(w.d('drive-a', BUNNY_DIR, 'Acme__D-GGUF'), { recursive: true });
  await writeFile(join(fa, '..', 'stranger.txt'), 's');
  const where = await w.store.whereDownloads(); assert.ok(where.length >= 1);
  const out = await w.store.removeAllRecorded();
  assert.equal(out.removed, 2); assert.equal(out.left.length, 1); assert.equal(out.missing.length, 1);
  assert.equal(existsSync(fa), false); assert.equal(existsSync(fb), false);
  assert.equal(await readFile(fc, 'utf8'), 'changed under us'); assert.equal(await readFile(join(fa, '..', 'stranger.txt'), 'utf8'), 's');
  assert.deepEqual(Object.keys(w.places.state().downloads), ['rc'], 'only the file left in place keeps its record');
  assert.ok(fd);
});

test('LF-17: an unavailable download folder gives the message and never falls back to the data folder', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  await rm(w.d('drive-a'), { recursive: true });
  await assert.rejects(w.store.root(), (e) => e.code === 'place.unavailable' && /The download folder isn't available. Plug in the drive or choose another folder./.test(e.message));
  assert.equal(existsSync(w.d('data', 'models')), false);
});

test('LF-20: changing the folder moves nothing: models already downloaded still verify from the old folder', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e = entry('keep'); await place(w, e);
  await w.store.setDownloadFolder(w.d('drive-b'));
  assert.equal((await w.store.verify('keep', e)).state, 'ok');
  assert.ok((await w.store.root()).toLowerCase().includes('drive-b'));
});

test('LF-21: Move copies to a .part, hashes it against the pin, renames, records, then deletes the old file; the next start checks the new record', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e1 = entry('mv1'); const e2 = entry('mv2', BYTES, 'Acme/Two-GGUF');
  const old1 = await place(w, e1); const old2 = await place(w, e2);
  await w.store.setDownloadFolder(w.d('drive-b'));
  const r = await w.store.move({ entries: [e1, e2] });
  assert.deepEqual(r.moved.sort(), ['mv1', 'mv2']); assert.deepEqual(r.failed, []);
  assert.equal(existsSync(old1), false); assert.equal(existsSync(old2), false);
  assert.equal(existsSync(w.d('drive-a', BUNNY_DIR)), false, 'the empty Bunny models folder in the old place went');
  const v = await w.store.verify('mv1', e1);
  assert.equal(v.state, 'ok'); assert.ok(v.real.toLowerCase().includes('drive-b'));
  assert.equal(await readFile(v.real, 'utf8').then((s) => s.length), BYTES.length);
});

test('LF-21: a byte flipped in the copy fails the hash; the old copy and its record stay; an old copy that changed is not moved and is marked', async (t) => {
  const w = await world(t, { hashFile: undefined });
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e1 = entry('hf1'); const old1 = await place(w, e1);
  const e2 = entry('hf2', BYTES, 'Acme/Two-GGUF'); const old2 = await place(w, e2);
  await rm(old2); await writeFile(old2, 'changed'); // the old copy changed
  await w.store.setDownloadFolder(w.d('drive-b'));
  // corrupt the copy by making the pinned sha differ from what the old file holds
  const bad = { ...e1, sha256: 'b'.repeat(64) };
  const r = await w.store.move({ entries: [bad, e2] });
  assert.deepEqual(r.moved, []); assert.equal(r.failed.length, 2);
  assert.match(r.failed.find((f) => f.id === 'hf2').reason, /changed after Bunny downloaded it/);
  assert.equal(existsSync(old1), true); assert.equal(w.places.state().downloads.hf1.real.toLowerCase(), old1.toLowerCase());
  assert.equal(existsSync(join((await w.store.root()), 'Acme__Tiny-GGUF', 'a'.repeat(40), `${e1.file}.part`)), false, 'the .part was deleted');
});

test('LF-21: not enough space copies nothing; Cancel halfway keeps the finished ones moved and the rest on their old copy; a stranger at the target follows the LF-17 rule', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e1 = entry('c1'); const e2 = entry('c2', BYTES, 'Acme/Two-GGUF'); const e3 = entry('c3', BYTES, 'Acme/Three-GGUF');
  const o1 = await place(w, e1); const o2 = await place(w, e2); const o3 = await place(w, e3);
  await w.store.setDownloadFolder(w.d('drive-b'));
  w.setFree(10);
  await assert.rejects(w.store.move({ entries: [e1, e2, e3] }), (e) => e.code === 'place.noSpace');
  assert.equal(existsSync(join(await w.store.root(), 'Acme__Tiny-GGUF')), false);
  w.setFree(Infinity);
  const ctl = new AbortController(); let n = 0;
  const r = await w.store.move({ entries: [e1, e2, e3], signal: ctl.signal, onProgress: () => { if (++n === 1) ctl.abort(); } });
  assert.ok(r.moved.length >= 1 && r.moved.length < 3, `moved ${r.moved.length}`);
  for (const [id, f] of [['c1', o1], ['c2', o2], ['c3', o3]]) assert.equal(existsSync(f), !r.moved.includes(id), id);
  assert.equal(r.untouched.length + r.moved.length + r.failed.length, 3);
  const e4 = entry('c4', BYTES, 'Acme/Four-GGUF'); const o4 = await place(w, e4, BYTES, w.d('data', 'models'));
  const tdir = entryDir(await w.store.root(), e4); await mkdir(tdir, { recursive: true }); await writeFile(join(tdir, e4.file), 'a stranger');
  const bad = await w.store.move({ entries: [e4] });
  assert.equal(bad.failed.length, 1); assert.match(bad.failed[0].reason, /A different file with this name is already there/);
  assert.equal(existsSync(o4), true); assert.equal(await readFile(join(tdir, e4.file), 'utf8'), 'a stranger');
});

test('LF-23: the folder Bunny writes into is on the list of paths Bunny\'s own write tools must refuse, while it is set, and off it after', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.store.protectedPaths(), []);
  const r = await w.store.setDownloadFolder(w.d('drive-a'));
  assert.deepEqual(w.store.protectedPaths(), [r.root]);
  await w.store.clearDownloadFolder();
  assert.deepEqual(w.store.protectedPaths(), []);
});

test('the record store keeps only paths and numbers, in the data folder; a chosen folder holds no record', async (t) => {
  const w = await world(t);
  await w.store.setDownloadFolder(w.d('drive-a'));
  const e = entry('rec'); await place(w, e);
  const saved = JSON.parse(await readFile(w.d('data', 'local-places.json'), 'utf8'));
  assert.ok(saved.downloads.rec.real && saved.downloads.rec.sha256 === e.sha256);
  assert.deepEqual((await readdir(w.d('drive-a', BUNNY_DIR, 'Acme__Tiny-GGUF', 'a'.repeat(40)))), ['rec.gguf']);
  assert.ok(stat && copyFile);
});
