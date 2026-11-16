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
  assert.deepEqual(lineDiff('same', 'same'), { added: 0, removed: 0, lines: [], tooLarge: false });
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
