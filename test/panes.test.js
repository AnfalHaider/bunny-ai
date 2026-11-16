/**
 * The Changes and Files panes' data (D-2, Q2-4, Q2-5): read-only, and never outside the chat's folder.
 * Security reviews this file's attack cases first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inside, listFolder, readTextFile, lineDiff, changesFor, MAX_READ } from '../src/server/panes.js';
import { startApp, post, json } from './helpers.js';

const folder = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-panes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.js'), 'one\ntwo\nthree\n');
  await writeFile(join(dir, 'README.md'), '# hi\n');
  await mkdir(join(dir, '.git')); await mkdir(join(dir, 'node_modules'));
  return dir;
};

test('every way out of the folder is refused', async (t) => {
  const dir = await folder(t);
  for (const bad of ['..', '../x', '..\\x', 'src/../../x', '/etc/passwd', 'C:\\Windows', 'C:/Windows', '\\\\server\\share\\a', 'a\0b']) {
    await assert.rejects(() => inside(dir, bad), (e) => /^path\./.test(e.code), JSON.stringify(bad));
  }
  await assert.rejects(() => inside(dir, 'nope.txt'), (e) => e.code === 'path.notFound');
});

test('a link inside the folder that points outside is refused (junction or symlink)', async (t) => {
  const dir = await folder(t);
  const outside = await mkdtemp(join(tmpdir(), 'bunny-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'top secret');
  try { await symlink(outside, join(dir, 'escape'), 'junction'); } catch { t.skip('links cannot be made here'); return; }
  await assert.rejects(() => inside(dir, 'escape'), (e) => e.code === 'path.outside');
  await assert.rejects(() => readTextFile(dir, 'escape/secret.txt'), (e) => e.code === 'path.outside');
  await assert.rejects(() => listFolder(dir, 'escape'), (e) => e.code === 'path.outside');
});

test('listing: folders first, by name, .git and node_modules left out', async (t) => {
  const dir = await folder(t);
  const top = await listFolder(dir, '');
  assert.deepEqual(top.entries.map((e) => `${e.type}:${e.name}`), ['folder:src', 'file:README.md']);
  assert.deepEqual((await listFolder(dir, 'src')).entries.map((e) => e.name), ['a.js']);
  await assert.rejects(() => listFolder(dir, 'README.md'), (e) => e.code === 'path.notFolder');
});

test('reading: text comes back, binary is described, big files are cut, folders are refused', async (t) => {
  const dir = await folder(t);
  const f = await readTextFile(dir, 'src/a.js');
  assert.equal(f.text, 'one\ntwo\nthree\n');
  assert.equal(f.binary, false);
  await writeFile(join(dir, 'pic.bin'), Buffer.from([1, 2, 0, 3]));
  assert.deepEqual(await readTextFile(dir, 'pic.bin'), { path: 'pic.bin', name: 'pic.bin', binary: true, bytes: 4 });
  await writeFile(join(dir, 'big.txt'), 'x'.repeat(MAX_READ + 10));
  const big = await readTextFile(dir, 'big.txt');
  assert.equal(big.truncated, true);
  assert.equal(big.text.length, MAX_READ);
  await assert.rejects(() => readTextFile(dir, 'src'), (e) => e.code === 'path.notFile');
});

test('lineDiff: added, removed, context, and a summary for huge files', () => {
  const d = lineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', 'a\nb\nc\nd\nE\nf\ng\nh\ni\nj\nk\n');
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.ok(d.lines.includes('-e') && d.lines.includes('+E') && d.lines.includes('+k'));
  assert.deepEqual(lineDiff('', 'x\ny\n').lines.filter((l) => l[0] === '+'), ['+x', '+y', '+']);
  assert.equal(lineDiff('a\n'.repeat(3000), 'b\n').tooLarge, true);
  assert.deepEqual(lineDiff('same', 'same'), { added: 0, removed: 0, lines: [], addedAt: [], tooLarge: false });
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nX\nc\nd').addedAt, [2, 4], 'the lines of the NEW file that changed');
});

test('changesFor: new and edited files from the saved copies, files outside the folder left out', async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, 'new.txt'), 'hello\n');
  const cps = [{
    id: 'c1', at: '2026-01-01T00:00:00Z', restored: false, files: [
      { path: join(dir, 'src', 'a.js'), existed: true, data: Buffer.from('one\ntwo\n').toString('base64') },
      { path: join(dir, 'new.txt'), existed: false },
      { path: join(tmpdir(), 'somewhere-else.txt'), existed: false },
    ],
  }];
  const out = await changesFor(dir, cps);
  const files = out.checkpoints[0].files;
  assert.deepEqual(files.map((f) => [f.path, f.status]), [['src/a.js', 'edited'], ['new.txt', 'new']]);
  assert.equal(files[0].added, 1);
  assert.equal(out.totals.files, 2);
});

// ---- through the app, guard on

const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
async function writerServer(t) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"writer"}]}'); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.messages.some((m) => m.role === 'tool')) { res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'note.txt', content: 'carrots\n' }) } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('the routes: a reply that wrote a file shows in Changes and Files, and a path out of the folder is refused', async (t) => {
  const { base } = await startApp(t, { fake: false, localGuard: true, apiToken: 'panes-token' });
  const H = { 'content-type': 'application/json', 'x-bunny-token': 'panes-token' };
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: H });
  await call('/api/providers/openai/connect', { method: 'POST', body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: await writerServer(t) }) });
  const dir = await folder(t);
  const s = await (await call('/api/sessions', { method: 'POST', body: JSON.stringify({ title: 'p', providerId: 'openai', model: 'writer' }) })).json();
  for (const [k, v] of [['folder', dir], ['workMode', 'code'], ['permissionMode', 'auto']]) await call(`/api/sessions/${s.id}/setting/${k}`, { method: 'PATCH', body: JSON.stringify({ value: v }) });
  await (await call(`/api/sessions/${s.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'write it', providerId: 'openai', model: 'writer', workMode: 'code' }) })).text();

  const changes = await (await call(`/api/sessions/${s.id}/changes`)).json();
  assert.equal(changes.checkpoints.length, 1);
  assert.deepEqual(changes.checkpoints[0].files.map((f) => [f.path, f.status, f.added]), [['note.txt', 'new', 2]]);

  const tree = await (await call(`/api/sessions/${s.id}/files`)).json();
  assert.ok(tree.entries.some((e) => e.name === 'note.txt'));
  const file = await (await call(`/api/sessions/${s.id}/file?path=note.txt`)).json();
  assert.equal(file.text, 'carrots\n');

  for (const bad of ['..%2F..%2Fetc', '%2Fetc%2Fpasswd', 'C%3A%5CWindows', 'src%2F..%2F..%2Fx']) {
    assert.equal((await call(`/api/sessions/${s.id}/file?path=${bad}`)).status, 400, bad);
    assert.equal((await call(`/api/sessions/${s.id}/files?path=${bad}`)).status, 400, bad);
  }
  assert.equal((await fetch(`${base}/api/sessions/${s.id}/changes`)).status, 403, 'no token: refused');
  const none = (await post(base, '/api/sessions', { title: 'x' })).body;
  assert.deepEqual((await json(base, `/api/sessions/${none.id}/changes`)).status, 403);
});

test('before a chat exists, only a folder the person chose this launch can be listed, read-only', async (t) => {
  const { base } = await startApp(t, { localGuard: true, apiToken: 'panes-token' });
  const H = { 'content-type': 'application/json', 'x-bunny-token': 'panes-token' };
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: H });
  const dir = await folder(t);
  const q = (p, extra = '') => `folder=${encodeURIComponent(dir)}&path=${encodeURIComponent(p)}${extra}`;
  assert.equal((await call(`/api/folder/files?${q('')}`)).status, 403, 'not chosen yet: refused');
  assert.equal((await call('/api/folder/check', { method: 'POST', body: JSON.stringify({ folder: dir }) })).status, 200);
  const list = await (await call(`/api/folder/files?${q('')}`)).json();
  assert.ok(list.entries.some((e) => e.name === 'README.md'));
  assert.equal((await (await call(`/api/folder/file?${q('README.md')}`)).json()).text, '# hi\n');
  for (const bad of ['..%2F..', '%2Fetc', 'C%3A%5CWindows']) assert.equal((await call(`/api/folder/files?folder=${encodeURIComponent(dir)}&path=${bad}`)).status, 400, bad);
  const other = await mkdtemp(join(tmpdir(), 'bunny-other-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  assert.equal((await call(`/api/folder/files?folder=${encodeURIComponent(other)}&path=`)).status, 403, 'a folder never chosen is refused');
  assert.equal((await fetch(`${base}/api/folder/files?${q('')}`)).status, 403, 'no token');
});

// ---- Security and Tech Lead's review of 5f36e04

test('Changes: a path through a link that leaves the folder is left out, and its content never appears (D2-1)', async (t) => {
  const dir = await folder(t);
  const outside = await mkdtemp(join(tmpdir(), 'bunny-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'OUTSIDE-SECRET\n');
  try { await symlink(outside, join(dir, 'dirlink'), 'junction'); } catch { t.skip('links cannot be made here'); return; }
  const out = await changesFor(dir, [{ id: 'c1', at: 'x', files: [
    { path: join(dir, 'dirlink', 'secret.txt'), existed: false },
    { path: join(dir, 'README.md'), existed: true, data: Buffer.from('old\n').toString('base64') },
  ] }]);
  assert.deepEqual(out.checkpoints[0].files.map((f) => f.path), ['README.md']);
  assert.ok(!JSON.stringify(out).includes('OUTSIDE-SECRET'));
});

test('Changes: edited files carry real counts, in a git folder and in a plain one (the +0 -0 report)', async (t) => {
  const { createCheckpoints } = await import('../src/server/checkpoints.js');
  const { execFileSync } = await import('node:child_process');
  for (const git of [false, true]) {
    const dir = await folder(t);
    if (git) { execFileSync('git', ['init', '-q'], { cwd: dir }); execFileSync('git', ['-c', 'user.email=a@example.test', '-c', 'user.name=T', 'add', '-A'], { cwd: dir }); execFileSync('git', ['-c', 'user.email=a@example.test', '-c', 'user.name=T', 'commit', '-qm', 'x'], { cwd: dir }); }
    const cps = createCheckpoints({ dir: join(dir, '.cp-store-outside-test') });
    const cp = cps.begin('11111111-1111-1111-1111-111111111111', dir);
    await cp.capture(join(dir, 'src', 'a.js'));
    await writeFile(join(dir, 'src', 'a.js'), 'one\nTWO\nthree\nfour\n');
    await cp.capture(join(dir, 'brand-new.txt'));
    await writeFile(join(dir, 'brand-new.txt'), 'hello\nthere\n');
    const out = await changesFor(dir, await cps.list('11111111-1111-1111-1111-111111111111'));
    const byPath = Object.fromEntries(out.checkpoints[0].files.map((f) => [f.path, f]));
    assert.deepEqual([byPath['src/a.js'].status, byPath['src/a.js'].added, byPath['src/a.js'].removed], ['edited', 2, 1], `git=${git}`);
    assert.deepEqual([byPath['brand-new.txt'].status, byPath['brand-new.txt'].added], ['new', 3], `git=${git}`);
    assert.deepEqual(out.totals, { files: 2, added: 5, removed: 1 });
  }
});

test('Changes: a long chat is capped, newest first, and says there is more', async (t) => {
  const dir = await folder(t);
  const cps = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, at: String(i), files: [{ path: join(dir, 'README.md'), existed: true, data: Buffer.from('x\n').toString('base64') }] }));
  const out = await changesFor(dir, cps);
  assert.equal(out.checkpoints.length, 20);
  assert.equal(out.checkpoints.at(-1).id, 'c29');
  assert.equal(out.more, true);
});

test('Reading: .git and node_modules are refused everywhere, the same as they are hidden from the list (D2-4)', async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://token@example.invalid/x.git\n');
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'x');
  for (const bad of ['.git', '.git/config', '.GIT/config', 'node_modules', 'node_modules/pkg/index.js']) {
    await assert.rejects(() => readTextFile(dir, bad), (e) => e.code === 'path.hidden' || e.code === 'path.notFile', bad);
    await assert.rejects(() => listFolder(dir, bad), (e) => e.code === 'path.hidden', bad);
  }
});

test('Reading a huge file costs one chunk, not the file (D2-2)', async (t) => {
  const dir = await folder(t);
  await writeFile(join(dir, 'huge.txt'), Buffer.alloc(MAX_READ * 8, 97));
  const before = process.memoryUsage().arrayBuffers;
  const f = await readTextFile(dir, 'huge.txt');
  assert.equal(f.text.length, MAX_READ);
  assert.equal(f.bytes, MAX_READ * 8, 'the size reported is the real size');
  assert.equal(f.truncated, true);
  assert.ok(process.memoryUsage().arrayBuffers - before < MAX_READ * 4, 'the whole file was not held');
});

test('Folders Bunny never browses: a drive root, its own data folder, a folder that holds it (D2-5)', async (t) => {
  const { app, base, dataDir } = await startApp(t, { localGuard: true, apiToken: 'panes-token' });
  const H = { 'content-type': 'application/json', 'x-bunny-token': 'panes-token' };
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: H });
  const { parse, dirname } = await import('node:path');
  for (const bad of [dataDir, dirname(dataDir), parse(dataDir).root]) {
    await call('/api/folder/check', { method: 'POST', body: JSON.stringify({ folder: bad }) });
    assert.equal(await app.chooseFolder(bad), false, bad);
    assert.equal((await call(`/api/folder/files?folder=${encodeURIComponent(bad)}&path=`)).status, 403, bad);
  }
});

test('In the desktop app only the native picker chooses a folder; a typed check does not (D2-5)', async (t) => {
  const { app, base } = await startApp(t, { localGuard: true, apiToken: 'panes-token', folderPickerOnly: true });
  const H = { 'content-type': 'application/json', 'x-bunny-token': 'panes-token' };
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: H });
  const dir = await folder(t);
  assert.equal((await call('/api/folder/check', { method: 'POST', body: JSON.stringify({ folder: dir }) })).status, 200);
  assert.equal((await call(`/api/folder/files?folder=${encodeURIComponent(dir)}&path=`)).status, 403, 'checking is not choosing');
  assert.equal(await app.chooseFolder(dir), true); // what the main process does with the native picker's answer
  assert.equal((await call(`/api/folder/files?folder=${encodeURIComponent(dir)}&path=`)).status, 200);
});

test('a chat saved before D-2 (old message shapes) still loads through every pane route', async (t) => {
  const { base } = await startApp(t);
  const dir = await folder(t);
  const made = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'old', folder: dir, messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', kind: 'tool_call', content: 'x' },
    { role: 'assistant', kind: 'error' },
    { role: 'assistant', kind: 'partial', content: 'cut' },
  ] }) })).json();
  for (const p of ['changes', 'files', 'file?path=README.md']) assert.equal((await fetch(`${base}/api/sessions/${made.id}/${p}`)).status, 200, p);
});

test('no routes write: POST, PUT and DELETE on the pane paths do nothing', async (t) => {
  const { base } = await startApp(t);
  const s = (await post(base, '/api/sessions', { title: 'x' })).body;
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const p of ['changes', 'files', 'file?path=a']) {
      const res = await fetch(`${base}/api/sessions/${s.id}/${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      assert.ok([404, 405].includes(res.status), `${method} ${p} -> ${res.status}`);
    }
  }
});
