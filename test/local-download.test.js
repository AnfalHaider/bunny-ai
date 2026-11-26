/**
 * LOCAL-MODELS LM-5d and Security's LM-14 item 10, with stand-in hosts and a 4 KB invented "model". No real host, no real model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, symlink, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { downloadModel, deleteModel, modelDir, checkEntry, DownloadError } from '../src/server/localDownload.js';

const BYTES = Buffer.alloc(4096, 7);
const SHA = createHash('sha256').update(BYTES).digest('hex');
const REV = 'a'.repeat(40);
const ENTRY = { id: 'tiny', repo: 'Acme/Tiny-GGUF', revision: REV, file: 'tiny-q4.gguf', size: BYTES.length, sha256: SHA, licence: 'apache-2.0', gated: false };
const HOSTS = ['huggingface.co', 'cdn-lfs.huggingface.co'];

async function temp(t) { const d = await mkdtemp(join(tmpdir(), 'bunny-lm-')); t.after(() => rm(d, { recursive: true, force: true })); return d; }

/** A stand-in Hugging Face: the origin redirects to a CDN host; the CDN serves `body` (with Range). Options break it in one way each. */
function stand({ cdn = 'cdn-lfs.huggingface.co', linkedSize = BYTES.length, linkedEtag = SHA, chunk = 1024, body = BYTES, statuses = [] } = {}) {
  const seen = [];
  const fetchImpl = async (url, { headers = {} } = {}) => {
    seen.push({ url, headers });
    const u = new URL(url);
    if (statuses.length) return statuses.shift();
    if (u.hostname === 'huggingface.co') return { status: 302, headers: { location: `https://${cdn}/blob/x`, 'x-linked-size': String(linkedSize), 'x-linked-etag': `"${linkedEtag}"` }, body: [] };
    const from = headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)[1]) : 0;
    const slice = body.subarray(from);
    return { status: from ? 206 : 200, headers: {}, body: (async function* () { for (let i = 0; i < slice.length; i += chunk) yield slice.subarray(i, i + chunk); })() };
  };
  fetchImpl.seen = seen;
  return fetchImpl;
}

test('a good download lands read-only with a manifest, the hash agreed three ways', async (t) => {
  const dir = await temp(t);
  const progress = [];
  const { path, manifest } = await downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand(), hosts: HOSTS, onProgress: (p) => progress.push(p.done) });
  assert.deepEqual(await readFile(path), BYTES);
  assert.equal(manifest.sha256, SHA);
  assert.equal(path, join(modelDir(dir, ENTRY), 'tiny-q4.gguf'));
  assert.equal(((await stat(path)).mode & 0o200) === 0, true, 'read-only');
  assert.ok(existsSync(`${path}.manifest.json`));
  assert.equal(progress.at(-1), BYTES.length);
  assert.equal(existsSync(`${path}.part`), false);
});

test('a hash mismatch deletes the file', async (t) => {
  const dir = await temp(t);
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand({ body: Buffer.alloc(4096, 9) }), hosts: HOSTS }), (e) => e.code === 'local.hash');
  assert.equal(existsSync(join(modelDir(dir, ENTRY), 'tiny-q4.gguf')), false);
  assert.equal(existsSync(join(modelDir(dir, ENTRY), 'tiny-q4.gguf.part')), false);
});

test('headers that disagree with the pin download nothing (size, then etag) and say the model changed', async (t) => {
  const dir = await temp(t);
  for (const bad of [{ linkedSize: 999 }, { linkedEtag: 'f'.repeat(64) }]) {
    const f = stand(bad);
    await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: f, hosts: HOSTS }), (e) => e.code === 'local.changed' && /changed on Hugging Face/.test(e.message));
    assert.equal(f.seen.length, 1, 'only the origin was asked; the CDN never was');
  }
});

test('a redirect to a host off the list stops the download, even one that only starts like a listed host', async (t) => {
  const dir = await temp(t);
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand({ cdn: 'evil.example.com' }), hosts: HOSTS }), (e) => e.code === 'local.host');
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand({ cdn: 'cdn-lfs.huggingface.co.evil.example' }), hosts: HOSTS }), (e) => e.code === 'local.host');
});

test('a short download keeps its .part; the next one hashes what is on disk, resumes with Range, and the whole file verifies', async (t) => {
  const dir = await temp(t);
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand({ body: BYTES.subarray(0, 2048) }), hosts: HOSTS }), (e) => e.code === 'local.short');
  assert.equal((await stat(join(modelDir(dir, ENTRY), 'tiny-q4.gguf.part'))).size, 2048);
  const f = stand();
  const { path } = await downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: f, hosts: HOSTS });
  assert.ok(f.seen.some((s) => s.headers.range === 'bytes=2048-'), 'resumed with Range');
  assert.deepEqual(await readFile(path), BYTES);
});

test('a .part whose bytes were damaged does not verify: the final hash fails and nothing is kept', async (t) => {
  const dir = await temp(t);
  const d = modelDir(dir, ENTRY);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'tiny-q4.gguf.part'), Buffer.alloc(2048, 1));
  await writeFile(join(d, 'tiny-q4.gguf.part.json'), JSON.stringify({ bytes: 2048 }));
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand(), hosts: HOSTS }), (e) => e.code === 'local.hash');
  assert.equal(existsSync(join(d, 'tiny-q4.gguf')), false);
});

test('Cancel deletes the .part', async (t) => {
  const dir = await temp(t);
  const ctl = new AbortController();
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand({ chunk: 512 }), hosts: HOSTS, signal: ctl.signal, onProgress: (p) => { if (p.done >= 1024) ctl.abort(); } }), (e) => e.code === 'local.cancelled');
  assert.equal(existsSync(join(modelDir(dir, ENTRY), 'tiny-q4.gguf.part')), false);
});

test('not enough free space starts nothing', async (t) => {
  const dir = await temp(t);
  const f = stand();
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: f, hosts: HOSTS, freeBytes: async () => BYTES.length + 1000 }), (e) => e.code === 'local.noSpace');
  assert.equal(f.seen.length, 0);
});

test('429 waits for RateLimit-Reset and retries, at most 3 times', async (t) => {
  const dir = await temp(t);
  const waits = [];
  const limited = () => ({ status: 429, headers: { 'ratelimit-reset': '7' }, body: [] });
  const ok = await downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand({ statuses: [limited(), limited()] }), hosts: HOSTS, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [7000, 7000]);
  assert.ok(ok.path);
  const dir2 = await temp(t);
  await assert.rejects(downloadModel({ dataDir: dir2, entry: ENTRY, fetchImpl: stand({ statuses: [limited(), limited(), limited(), limited()] }), hosts: HOSTS, sleep: async () => {} }), (e) => e.code === 'local.rateLimited');
});

test('only a pinned .gguf of a non-gated model, with a fixed commit and a fingerprint, is ever fetched', () => {
  for (const [bad, code] of [[{ file: 'model.safetensors' }, 'local.notGguf'], [{ file: 'tokenizer.py' }, 'local.notGguf'], [{ file: 'x.bin' }, 'local.notGguf'], [{ gated: true }, 'local.gated'], [{ revision: 'main' }, 'local.badRevision'], [{ sha256: '' }, 'local.noPin'], [{ size: 0 }, 'local.noPin']]) {
    assert.throws(() => checkEntry({ ...ENTRY, ...bad }), (e) => e instanceof DownloadError && e.code === code, JSON.stringify(bad));
  }
});

test('a bad name part is refused: dots, separators, a missing or extra repo part, a too long name', () => {
  for (const bad of [{ file: '..' }, { file: 'a/b.gguf' }, { file: 'a\\b.gguf' }, { repo: 'Acme/../x' }, { repo: 'Acme' }, { repo: 'a/b/c' }, { file: `${'x'.repeat(129)}.gguf` }, { revision: `${'a'.repeat(39)}/` }]) {
    assert.throws(() => modelDir('/tmp/d', { ...ENTRY, ...bad }), (e) => e.code === 'local.badName', JSON.stringify(bad));
  }
});

test('a link at the target is refused', async (t) => {
  const dir = await temp(t);
  const elsewhere = await temp(t);
  const d = modelDir(dir, ENTRY);
  await mkdir(d, { recursive: true });
  try { await symlink(join(elsewhere, 'x.gguf'), join(d, 'tiny-q4.gguf'), 'file'); } catch { t.skip('this account cannot make links'); return; }
  await assert.rejects(downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand(), hosts: HOSTS }), (e) => e.code === 'local.link');
  assert.equal(existsSync(join(elsewhere, 'x.gguf')), false);
});

test('delete removes the model folder and nothing else', async (t) => {
  const dir = await temp(t);
  await downloadModel({ dataDir: dir, entry: ENTRY, fetchImpl: stand(), hosts: HOSTS });
  await writeFile(join(dir, 'models', 'keep.txt'), 'keep');
  assert.equal(await deleteModel({ dataDir: dir, entry: ENTRY }), true);
  assert.equal(existsSync(modelDir(dir, ENTRY)), false);
  assert.equal(existsSync(join(dir, 'models', 'keep.txt')), true);
  assert.equal(await deleteModel({ dataDir: dir, entry: ENTRY }), false);
});
