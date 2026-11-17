// Security's v0.1.8 findings: W613-2 (IPv4-translated addresses), W6-NEW-1 (nothing written into .git), W6-21 (honest note on huge results).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/server/workspace.js';
import { isPrivateAddress } from '../src/server/download.js';
import { fitResult } from '../src/server/chat.js';

test('W613-2: an IPv4-translated address (::ffff:0:a.b.c.d) is judged by the IPv4 inside it', () => {
  assert.equal(isPrivateAddress('::ffff:0:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:0:169.254.169.254'), true);
  assert.equal(isPrivateAddress('::ffff:0:10.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:0:8.8.8.8'), false, 'a public address inside stays public');
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true, 'IPv4-mapped is still blocked');
});

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-git-'));
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  await writeFile(join(dir, '.git', 'config'), '[core]\n');
  await mkdir(join(dir, 'sub', '.git'), { recursive: true });
  await writeFile(join(dir, 'ok.txt'), 'one\n');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, ws: createWorkspace(dir) };
}

test('W6-NEW-1: write_file, edit_file, multi_edit and download_file refuse any path inside .git', async (t) => {
  const { dir, ws } = await folder(t);
  for (const path of ['.git/hooks/pre-commit', '.GIT/hooks/pre-commit', '.git./hooks/pre-commit', 'sub/.git/hooks/post-commit', '.git/config', 'GIT~1/hooks/x']) {
    await assert.rejects(() => ws.run('write_file', { path, content: '#!/bin/sh\necho owned\n' }), /inside \.git/, `write_file ${path}`);
    await assert.rejects(() => ws.run('download_file', { url: 'http://example.invalid/x', path }), /inside \.git/, `download_file ${path}`);
  }
  await assert.rejects(() => ws.run('edit_file', { path: '.git/config', old_text: 'core', new_text: 'evil' }), /inside \.git/);
  await assert.rejects(() => ws.run('multi_edit', { path: '.git/config', edits: [{ old_text: 'core', new_text: 'evil' }] }), /inside \.git/);
  assert.equal(await readFile(join(dir, '.git', 'config'), 'utf8'), '[core]\n', 'the file is untouched');
  assert.equal(existsSync(join(dir, '.git', 'hooks', 'pre-commit')), false);
});

test('W6-NEW-1: names that only look like .git are ordinary', async (t) => {
  const { dir, ws } = await folder(t);
  for (const path of ['.gitignore', '.github/workflows/ci.yml', 'my.git/x.txt', 'notes/gitnotes.txt']) {
    await ws.run('write_file', { path, content: 'fine\n' });
    assert.equal(existsSync(join(dir, path)), true, path);
  }
  await ws.run('edit_file', { path: 'ok.txt', old_text: 'one', new_text: 'two' });
  assert.equal(await readFile(join(dir, 'ok.txt'), 'utf8'), 'two\n');
});

test('W6-NEW-1: a link or junction that leads into .git is refused too', async (t) => {
  const { dir, ws } = await folder(t);
  try { await symlink(join(dir, '.git'), join(dir, 'gl'), 'junction'); } catch { t.skip('links are not allowed here'); return; }
  await assert.rejects(() => ws.run('write_file', { path: 'gl/hooks/pre-commit', content: 'x' }), /inside \.git|outside/);
  assert.equal(existsSync(join(dir, '.git', 'hooks', 'pre-commit')), false);
});

test('W6-21: only a result that can really be saved is said to be saved', () => {
  const small = fitResult('run_command', 'x'.repeat(60_000));
  assert.match(small, /saved in \.bunny\/notes/);
  const huge = fitResult('run_command', 'x'.repeat(200_000));
  assert.doesNotMatch(huge, /saved in \.bunny\/notes/);
  assert.match(huge, /too large to be saved/);
  assert.match(fitResult('read_file', 'x'.repeat(200_000)), /start_line and end_line/);
});

test('W69-1 review: a file address with a host, a UNC path or a device path is never looked up, so no network share is reached', async (t) => {
  const { ws } = await folder(t);
  assert.equal(ws.fileUrlPath('file://evil.example/share/x.txt'), null);
  assert.equal(ws.fileUrlPath('file:////evil.example/share/x.txt'), null);
  assert.equal(ws.fileUrlPath('http://x/y'), null);
  assert.equal(ws.fileUrlPath('not a url'), null);
  assert.ok(ws.fileUrlPath('file:///C:/Windows/win.ini') || ws.fileUrlPath('file:///etc/hosts'), 'a plain local file address still gives its path');
  // canon decides by spelling when the path leaves the folder
  const slash = String.fromCharCode(92);
  const unc = slash + slash + 'evil.example' + slash + 'share' + slash + 'x.txt';
  assert.equal(await ws.canon(unc), null);
  assert.equal(await ws.canon('../outside.txt'), null);
  assert.equal(await ws.canon('ok.txt'), 'ok.txt');
});
