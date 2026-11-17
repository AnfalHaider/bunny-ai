import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktrees } from '../src/server/worktrees.js';
import { createBrowserViews, isLanAddressResolved } from '../electron/browserViews.js';

// Security's three LOWs on W2-9 (4c6a189): taskkill by full path in procGuard; a name that resolves to a private address; git filter drivers in a project's own settings.
const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
const tmp = (name) => realpathSync(mkdtempSync(join(tmpdir(), `bunny-lows-${name}-`)));
const clean = (t, ...dirs) => t.after(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* gone */ } } });
const ID = 'aaaaaaaa-1111-4111-8111-111111111111';

test('LOW 1: no program in src/server or electron is started by a bare name that Windows would look up in the current folder (taskkill, powershell, git, gh)', () => {
  const root = new URL('..', import.meta.url);
  const files = (dir) => readdirSync(new URL(dir, root)).filter((f) => f.endsWith('.js')).map((f) => [`${dir}${f}`, readFileSync(new URL(`${dir}${f}`, root), 'utf8')]);
  const bare = /\b(execFile|execFileSync|spawn|spawnSync)\(\s*'(taskkill|powershell\.exe|powershell|git|gh)'/;
  const hits = [...files('src/server/'), ...files('electron/')].filter(([, text]) => bare.test(text)).map(([name]) => name);
  assert.deepEqual(hits, [], 'bare names left');
  assert.match(readFileSync(new URL('src/server/procGuard.js', root), 'utf8'), /taskkillPath\(\)/);
});

test('LOW 2: a public name that resolves to a private address counts as a private address (192.168.1.1.nip.io), and a name that does not resolve is not fetched', async () => {
  const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address, family: 4 }));
  assert.equal(await isLanAddressResolved('http://192.168.1.1.nip.io/', resolvesTo('192.168.1.1')), true);
  assert.equal(await isLanAddressResolved('https://rebind.example/', resolvesTo('93.184.216.34', '10.0.0.5')), true, 'one private answer is enough');
  assert.equal(await isLanAddressResolved('https://example.com/', resolvesTo('93.184.216.34')), false);
  assert.equal(await isLanAddressResolved('https://example.com/', async () => { throw new Error('ENOTFOUND'); }), true);
  assert.equal(await isLanAddressResolved('http://192.168.1.5/', async () => { throw new Error('not asked'); }), true, 'an address is judged without asking DNS');
  assert.equal(await isLanAddressResolved('https://example.com/', resolvesTo('::1')), true, 'loopback over IPv6');
  // the compare itself refuses it before loading anything
  const loaded = [];
  class FakeWindow { constructor() { this.webContents = { setWindowOpenHandler() {}, on() {}, once() {}, loadURL: async (u) => { loaded.push(u); } }; } destroy() {} }
  const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } };
  const views = createBrowserViews({ WebContentsView: class {}, session: { fromPartition: () => ses }, getWindow: () => null, BrowserWindow: FakeWindow, nativeImage: {}, resolveName: resolvesTo('192.168.1.1') });
  const r = await views.compare({}, { a: 'https://example.com/', b: 'http://192.168.1.1.nip.io/' });
  assert.match(r.error, /private network/);
  assert.deepEqual(loaded, [], 'nothing was loaded');
});

test('LOW 3: a project whose own git settings define a filter program gets no copy; a copy made earlier refuses to be read or finished until the filter is gone', async (t) => {
  const repo = tmp('repo');
  const data = tmp('data');
  clean(t, repo, data);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  const wt = createWorktrees({ dataDir: data });
  const made = await wt.create({ sessionId: ID, folder: repo, prefix: 'bunny/', title: 'ok' });
  assert.equal((await wt.eligibility(repo)).ok, true);
  for (const key of ['filter.evil.smudge', 'filter.evil.clean', 'filter.evil.process']) {
    git(repo, 'config', key, 'node -e 0');
    const e = await wt.eligibility(repo);
    assert.equal(e.ok, false, key);
    assert.match(e.reason, /runs its own programs when git checks files out/);
    await assert.rejects(wt.create({ sessionId: 'bbbbbbbb-2222-4222-8222-222222222222', folder: repo, prefix: 'bunny/', title: 'no' }), /runs its own programs/);
    await assert.rejects(wt.status(made), /runs its own programs/, 'the copy made earlier is not read through the filter');
    const finish = await wt.finish(made, { action: 'keep' });
    assert.equal(finish.ok, false);
    assert.match(finish.reason, /runs its own programs/);
    assert.ok(statSync(made.path).isDirectory(), 'nothing was changed');
    git(repo, 'config', '--unset', key);
  }
  assert.equal((await wt.eligibility(repo)).ok, true, 'with no filter it is eligible again');
  assert.equal((await wt.status(made)).dirty, 0);
});

test('LOW 3 (Security, w2-9-lows): only the exact values `git lfs install` writes are let through; a standard value with anything after it refuses the copy', async (t) => {
  const repo = tmp('lfs');
  const data = tmp('lfsdata');
  clean(t, repo, data);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  const wt = createWorktrees({ dataDir: data });
  const standard = { 'filter.lfs.clean': 'git-lfs clean -- %f', 'filter.lfs.smudge': 'git-lfs smudge -- %f', 'filter.lfs.process': 'git-lfs filter-process' };
  for (const [key, value] of Object.entries(standard)) git(repo, 'config', key, value);
  assert.equal((await wt.eligibility(repo)).ok, true, 'the three standard values are let through');
  const made = await wt.create({ sessionId: ID, folder: repo, prefix: 'bunny/', title: 'lfs' });
  assert.ok(statSync(made.path).isDirectory(), 'a copy is made');
  assert.equal((await wt.status(made)).dirty, 0);
  await wt.finish(made, { action: 'discard' });
  for (const [key, value] of Object.entries(standard)) {
    for (const tail of [' ; calc.exe', ' && echo x', ' | tee y', ' & start x', ' $(whoami)', ' `id`', '\nx', ' --extra']) {
      git(repo, 'config', key, `${value}${tail}`);
      const e = await wt.eligibility(repo);
      assert.equal(e.ok, false, `${key} with "${tail.trim()}" after it`);
      assert.match(e.reason, /runs its own programs/);
      git(repo, 'config', key, value);
    }
  }
  // a different program, or the same words with another command word, is refused
  git(repo, 'config', 'filter.lfs.clean', 'git-lfs-evil clean -- %f');
  assert.equal((await wt.eligibility(repo)).ok, false);
  git(repo, 'config', 'filter.lfs.clean', standard['filter.lfs.clean']);
  git(repo, 'config', 'filter.other.clean', standard['filter.lfs.clean']);
  assert.equal((await wt.eligibility(repo)).ok, false, 'the standard value under another filter name is not LFS');
});
