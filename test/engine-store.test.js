import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineStoreError, createEngineStore, fetchPinned } from '../src/server/engines/store.js';
import { UnpackError, safeEntryPath, unpackTgz, unpackZip } from '../src/server/engines/unpack.js';
import { makeTgz, makeZip, sha256 } from './helpers-archives.js';

// CLI-ENGINES §4, CE-5, CE-9: the store's tests: a hash mismatch, a path escape, a redirect off the pin's hosts, a wrong version or signature are refused and the staging folder is removed;
// current.json is written atomically; rollback works; an update waits during a run; remove deletes everything. A fake registry stands in for the network.
const tmp = () => mkdtemp(join(tmpdir(), 'bunny-engine-'));

test('safeEntryPath: only a plain relative path under the folder', () => {
  assert.equal(safeEntryPath('package/claude.exe', 'package'), 'claude.exe');
  assert.equal(safeEntryPath('a/b/c.txt'), 'a/b/c.txt');
  assert.equal(safeEntryPath('a\\b\\c.txt'), 'a/b/c.txt');
  assert.equal(safeEntryPath('./x/y'), 'x/y');
  for (const bad of ['../x', 'a/../../x', '/abs/x', 'C:/x', 'c:\\x', 'a/b:stream', 'CON', 'a/nul.txt', 'a/com1', 'name.', 'name ', 'a/<b>', '', 'a\0b']) assert.throws(() => safeEntryPath(bad), UnpackError, JSON.stringify(bad));
  assert.throws(() => safeEntryPath('other/x', 'package'), UnpackError);
});

test('unpackZip writes the entries; a path escape, an absolute path, a data stream, a reserved name or a symlink is refused', async () => {
  const dir = await tmp();
  const good = join(dir, 'good.zip');
  await writeFile(good, makeZip([{ name: 'bin/', dir: true }, { name: 'bin/tool.exe', data: 'MZ-exe'.repeat(100) }, { name: 'readme.txt', data: 'hi', store: true }, { name: 'empty.txt', data: '' }]));
  const out = join(dir, 'out'); await mkdir(out);
  const written = await unpackZip(good, out);
  assert.deepEqual(written.sort(), ['bin/tool.exe', 'empty.txt', 'readme.txt']);
  assert.equal(await readFile(join(out, 'bin', 'tool.exe'), 'utf8'), 'MZ-exe'.repeat(100));
  assert.equal(await readFile(join(out, 'readme.txt'), 'utf8'), 'hi');
  for (const [label, entry] of [['escape', { name: '../evil.txt', data: 'x' }], ['absolute', { name: '/evil.txt', data: 'x' }], ['drive', { name: 'C:/evil.txt', data: 'x' }], ['stream', { name: 'a.txt:hidden', data: 'x' }], ['reserved', { name: 'aux', data: 'x' }], ['dot', { name: 'name.', data: 'x' }], ['link', { name: 'lnk', data: 'target', link: true }]]) {
    const f = join(dir, `${label}.zip`); await writeFile(f, makeZip([entry]));
    const o = join(dir, `o-${label}`); await mkdir(o);
    await assert.rejects(() => unpackZip(f, o), UnpackError, label);
    assert.deepEqual(await readdir(o), [], `${label}: nothing written`);
  }
  await assert.rejects(() => unpackZip(good, join(dir, 'limit'), { max: 100 }), /bigger than/, 'an archive bomb stops at the limit');
  await writeFile(join(dir, 'notzip.zip'), 'not a zip'); await assert.rejects(() => unpackZip(join(dir, 'notzip.zip'), out), /not a zip/);
});

test('unpackTgz strips the npm "package/" folder; links, escapes and a bomb are refused', async () => {
  const dir = await tmp();
  const good = join(dir, 'good.tgz');
  await writeFile(good, makeTgz([{ name: 'package/', dir: true }, { name: 'package/claude.exe', data: 'EXE'.repeat(300) }, { name: 'package/sub/readme.md', data: 'x' }]));
  const out = join(dir, 'out'); await mkdir(out);
  const written = await unpackTgz(good, out, { strip: 'package' });
  assert.deepEqual(written.sort(), ['claude.exe', 'sub/readme.md']);
  assert.equal(await readFile(join(out, 'claude.exe'), 'utf8'), 'EXE'.repeat(300));
  for (const [label, entries] of [['escape', [{ name: 'package/../../x', data: 'x' }]], ['symlink', [{ name: 'package/l', type: '2' }]], ['hardlink', [{ name: 'package/h', type: '1' }]], ['outside', [{ name: 'other/x', data: 'x' }]], ['stream', [{ name: 'package/a:b', data: 'x' }]]]) {
    const f = join(dir, `${label}.tgz`); await writeFile(f, makeTgz(entries));
    const o = join(dir, `o-${label}`); await mkdir(o);
    await assert.rejects(() => unpackTgz(f, o, { strip: 'package' }), UnpackError, label);
  }
  await assert.rejects(() => unpackTgz(good, join(dir, 'limit'), { strip: 'package', max: 100 }), /bigger than/);
});

test('fetchPinned: HTTPS only; a redirect must stay on the pin\'s hosts (GitHub\'s release host is one); too many redirects stop', async () => {
  const hosts = ['github.com', 'release-assets.githubusercontent.com'];
  const reply = (status, location) => ({ status, ok: status < 300, headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) }, body: { cancel() {} } });
  const via = (map) => async (url) => map[url] ?? reply(404);
  const ok = await fetchPinned('https://github.com/a/b.zip', hosts, { fetchImpl: via({ 'https://github.com/a/b.zip': reply(302, 'https://release-assets.githubusercontent.com/x'), 'https://release-assets.githubusercontent.com/x': reply(200) }) });
  assert.equal(ok.status, 200);
  await assert.rejects(() => fetchPinned('http://github.com/a', hosts, { fetchImpl: via({}) }), /HTTPS/);
  await assert.rejects(() => fetchPinned('https://github.com/a', hosts, { fetchImpl: via({ 'https://github.com/a': reply(302, 'https://evil.example/x') }) }), /not one of this engine's download sites/);
  await assert.rejects(() => fetchPinned('https://github.com/a', hosts, { fetchImpl: via({ 'https://github.com/a': reply(302, 'http://github.com/b') }) }), /HTTPS/, 'a redirect to http is refused');
  await assert.rejects(() => fetchPinned('https://evil.example/a', hosts, { fetchImpl: via({}) }), /not one of this engine's download sites/);
  const loop = reply(302, 'https://github.com/a');
  await assert.rejects(() => fetchPinned('https://github.com/a', hosts, { fetchImpl: via({ 'https://github.com/a': loop }) }), /too many times/);
  await assert.rejects(() => fetchPinned('https://github.com/a', hosts, { fetchImpl: via({ 'https://github.com/a': reply(500) }) }), /answered 500/);
});

// ---------------------------------------------------------------- the store, with a fake registry

function fakeRegistry(files) {
  // files: { url: Buffer }
  return async (url) => {
    const body = files[url];
    if (!body) return { status: 404, ok: false, headers: { get: () => null }, body: null };
    return { status: 200, ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(body.length) : null) }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(body)); c.close(); } }) };
  };
}

function setup(version = '1.2.3', exeText = 'EXE') {
  const archive = makeZip([{ name: 'eng.exe', data: exeText.repeat(50) }, { name: 'helper/h.exe', data: 'H' }]);
  const url = `https://example.test/eng-${version}.zip`;
  const pins = { eng: { version, entry: 'eng.exe', hosts: ['example.test'], signature: 'Test Co', files: [{ url, sha256: sha256(archive), kind: 'zip' }] } };
  return { archive, url, pins };
}

const deps = (extra = {}) => ({ versionOf: async () => 'eng 1.2.3', signatureOf: async () => ({ ok: true, signer: 'Test Co' }), ...extra });

test('download: verifies, unpacks, checks the signature and the printed version, switches, and writes the record (first 12 of the hash, who: the window)', async () => {
  const dataDir = await tmp();
  const { archive, url, pins } = setup();
  const store = createEngineStore({ dataDir, pins, fetchImpl: fakeRegistry({ [url]: archive }), ...deps() });
  const progress = [];
  const r = await store.download('eng', { onProgress: (p) => progress.push(p) });
  assert.deepEqual([r.ok, r.version], [true, '1.2.3']);
  assert.ok(progress.length && progress.at(-1).bytes === archive.length);
  const current = JSON.parse(await readFile(join(dataDir, 'engines', 'eng', 'current.json'), 'utf8'));
  assert.equal(current.version, '1.2.3');
  assert.match(current.sha256, /^[a-f0-9]{64}$/);
  assert.ok(existsSync(join(dataDir, 'engines', 'eng', '1.2.3', 'eng.exe')));
  assert.deepEqual((await readdir(join(dataDir, 'engines', 'eng'))).filter((n) => n.startsWith('.staging')), [], 'no staging folder left');
  const rec = await store.record();
  assert.equal(rec.length, 1);
  assert.deepEqual([rec[0].engine, rec[0].action, rec[0].from, rec[0].to, rec[0].who, rec[0].sha12], ['eng', 'download', null, '1.2.3', 'window', current.sha256.slice(0, 12)]);
  const found = await store.locate('eng');
  assert.equal(found.ok, true);
  const st = (await store.status()).eng;
  assert.deepEqual([st.downloaded, st.version, st.available, st.updateAvailable, st.previous], [true, '1.2.3', '1.2.3', false, null]);
  assert.ok(st.sizeBytes > 100);
});

test('download refuses and cleans up: a hash mismatch, a path escape, a redirect off the pin\'s hosts, a wrong printed version, a missing or bad signature, a missing entry program', async () => {
  const cases = [];
  { const { url, pins } = setup(); cases.push(['hash', pins, fakeRegistry({ [url]: makeZip([{ name: 'eng.exe', data: 'tampered' }]) }), deps(), /fingerprint/]); }
  { const evil = makeZip([{ name: '../escape.exe', data: 'x' }]); const url = 'https://example.test/e.zip'; cases.push(['escape', { eng: { version: '1.2.3', entry: 'eng.exe', hosts: ['example.test'], signature: 'Test Co', files: [{ url, sha256: sha256(evil), kind: 'zip' }] } }, fakeRegistry({ [url]: evil }), deps(), /climbs out/]); }
  { const { url, archive, pins } = setup(); cases.push(['redirect', pins, async (u) => (u === url ? { status: 302, ok: false, headers: { get: () => 'https://evil.example/x' }, body: null } : { status: 404, ok: false, headers: { get: () => null } }), deps(), /not one of this engine's download sites/]); void archive; }
  { const { url, archive, pins } = setup(); cases.push(['version', pins, fakeRegistry({ [url]: archive }), deps({ versionOf: async () => 'eng 9.9.9' }), /not 1\.2\.3/]); }
  { const { url, archive, pins } = setup(); cases.push(['signature', pins, fakeRegistry({ [url]: archive }), deps({ signatureOf: async () => ({ ok: false, signer: 'Somebody' }) }), /not signed by Test Co/]); }
  { const url = 'https://example.test/n.zip'; const a = makeZip([{ name: 'other.exe', data: 'x' }]); cases.push(['entry', { eng: { version: '1.2.3', entry: 'eng.exe', hosts: ['example.test'], signature: 'Test Co', files: [{ url, sha256: sha256(a), kind: 'zip' }] } }, fakeRegistry({ [url]: a }), deps(), /did not hold the engine program/]); }
  for (const [label, pins, fetchImpl, d, pattern] of cases) {
    const dataDir = await tmp();
    const store = createEngineStore({ dataDir, pins, fetchImpl, ...d });
    await assert.rejects(() => store.download('eng'), (err) => err instanceof EngineStoreError && pattern.test(err.message), label);
    const left = await readdir(join(dataDir, 'engines', 'eng')).catch(() => []);
    assert.deepEqual(left, [], `${label}: the staging folder is removed and nothing was switched (${left.join(',')})`);
    assert.equal((await store.locate('eng')).ok, false, label);
  }
});

test('a pinned entrySha256 that does not match the installed program refuses the install', async () => {
  const dataDir = await tmp();
  const { archive, url, pins } = setup();
  pins.eng.entrySha256 = 'b'.repeat(64);
  const store = createEngineStore({ dataDir, pins, fetchImpl: fakeRegistry({ [url]: archive }), ...deps() });
  await assert.rejects(() => store.download('eng'), /does not match its pinned fingerprint/);
  assert.equal((await store.locate('eng')).ok, false);
});

test('an update keeps the previous version (and removes older ones); rollback goes back; locate notices a program changed on disk and says it can roll back', async () => {
  const dataDir = await tmp();
  const v1 = setup('1.2.3', 'ONE'); const v2 = setup('1.3.0', 'TWO'); const v3 = setup('1.4.0', 'THREE');
  const registry = fakeRegistry({ [v1.url]: v1.archive, [v2.url]: v2.archive, [v3.url]: v3.archive });
  const storeFor = (v, printed) => createEngineStore({ dataDir, pins: v.pins, fetchImpl: registry, versionOf: async () => printed, signatureOf: async () => ({ ok: true }) });
  await storeFor(v1, 'eng 1.2.3').download('eng');
  await storeFor(v2, 'eng 1.3.0').download('eng');
  assert.deepEqual((await readdir(join(dataDir, 'engines', 'eng'))).filter((n) => /^\d/.test(n)).sort(), ['1.2.3', '1.3.0']);
  const store = storeFor(v3, 'eng 1.4.0'); await store.download('eng');
  assert.deepEqual((await readdir(join(dataDir, 'engines', 'eng'))).filter((n) => /^\d/.test(n)).sort(), ['1.3.0', '1.4.0'], 'two kept: the older one is gone');
  assert.equal((await store.status()).eng.previous, '1.3.0');
  assert.equal((await store.rollback('eng')).version, '1.3.0');
  assert.equal((await store.locate('eng')).version, '1.3.0');
  const rec = await store.record();
  assert.deepEqual(rec.slice(0, 4).map((r) => [r.action, r.from, r.to]), [['rollback', '1.4.0', '1.3.0'], ['update', '1.3.0', '1.4.0'], ['update', '1.2.3', '1.3.0'], ['download', null, '1.2.3']]);
  // a program changed on disk
  await writeFile(join(dataDir, 'engines', 'eng', '1.3.0', 'eng.exe'), 'changed under us');
  const bad = await store.locate('eng');
  assert.deepEqual([bad.ok, bad.reason, bad.canRollBack], [false, 'changed', true]);
  // nothing downloaded: says so; no previous: cannot roll back
  const empty = createEngineStore({ dataDir: await tmp(), pins: v1.pins });
  assert.deepEqual(await empty.locate('eng'), { ok: false, reason: 'not-downloaded', canRollBack: false });
  await assert.rejects(() => empty.rollback('eng'), /no earlier version/);
});

test('an update, a switch and a removal wait while an answer runs on that engine; a download of an unknown engine is refused', async () => {
  const dataDir = await tmp();
  const { url, archive, pins } = setup();
  let running = false;
  const store = createEngineStore({ dataDir, pins, fetchImpl: fakeRegistry({ [url]: archive }), ...deps(), busy: () => running });
  await store.download('eng');
  running = true;
  await assert.rejects(() => store.download('eng'), /still running/);
  await assert.rejects(() => store.rollback('eng'), /still running/);
  await assert.rejects(() => store.remove('eng'), /still running/);
  running = false;
  await assert.rejects(() => store.download('nope'), /does not know/);
});

test('remove deletes every version, home and staged copy of the engine, and is recorded', async () => {
  const dataDir = await tmp();
  const { url, archive, pins } = setup();
  const store = createEngineStore({ dataDir, pins, fetchImpl: fakeRegistry({ [url]: archive }), ...deps() });
  await store.download('eng');
  await mkdir(join(dataDir, 'engines', 'eng', 'local', 'chat', 'c1'), { recursive: true });
  await writeFile(join(dataDir, 'engines', 'eng', 'local', 'chat', 'c1', 'session.json'), '{}');
  await store.remove('eng');
  assert.equal(existsSync(join(dataDir, 'engines', 'eng')), false);
  assert.equal((await store.record())[0].action, 'remove');
  assert.equal((await store.status()).eng.downloaded, false);
});

test('a cancelled download stops, says so, and leaves nothing behind', async () => {
  const dataDir = await tmp();
  const { archive, pins } = setup();
  const slow = async () => ({ status: 200, ok: true, headers: { get: () => String(archive.length) }, body: new ReadableStream({ async start(c) { c.enqueue(new Uint8Array(archive.subarray(0, 10))); await new Promise((r) => setTimeout(r, 400)); c.enqueue(new Uint8Array(archive.subarray(10))); c.close(); } }) });
  const store = createEngineStore({ dataDir, pins, fetchImpl: slow, ...deps() });
  const pending = store.download('eng');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(store.cancel('eng'), true);
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(await readdir(join(dataDir, 'engines', 'eng')), []);
});
