/**
 * W5-1 / item 3: toRepoPath resolves links, junctions, device prefixes and case, and fails closed.
 * Runs against the staged guard in scripts/guard-next/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { lib, guard, makeRepo } from './guard-016-helpers.js';

const W = path.win32;
const WROOT = 'D:\\repo';
const text = (p, cwd = WROOT) => lib.toRepoPath(WROOT, p, cwd, W, { canonical: false });
const refused = (v) => typeof v?.refused === 'string';

test('item 3 (text form): inside, detours, device prefixes, case, trailing dots and streams', () => {
  assert.equal(text('docs/a.md'), 'docs/a.md');
  assert.equal(text('docs/../.bootstrap/x'), '.bootstrap/x');
  assert.equal(text('\\\\?\\D:\\repo\\.bootstrap\\x'), '.bootstrap/x');
  assert.equal(text('\\\\.\\D:\\repo\\.bootstrap\\x'), '.bootstrap/x');
  assert.equal(text('\\\\?\\UNC\\srv\\sh\\a.md'), null, 'a UNC share outside the repo');
  assert.equal(text('D:\\REPO\\.BOOTSTRAP\\x'), '.BOOTSTRAP/x');
  assert.equal(text('.bootstrap.\\x'), '.bootstrap/x');
  assert.equal(text('.bootstrap \\x'), '.bootstrap/x');
  assert.equal(text('.bootstrap::$DATA'), '.bootstrap');
  assert.equal(text('C:\\other\\x'), null);
  assert.equal(text('..\\x'), null);
});

test('item 3 (text form): NUL and a drive-relative path are refused, not waved through', () => {
  assert.ok(refused(text('a\0b')));
  assert.ok(refused(text('C:x')));
  assert.equal(text(''), null);
});

test('item 3: protected paths stay protected whatever the spelling (scopeViolation on the canonical form)', () => {
  const policy = { protected_globs: ['.bootstrap/**', 'AGENTS.md'] };
  for (const p of ['\\\\?\\D:\\repo\\.bootstrap\\x', 'D:\\REPO\\.BOOTSTRAP\\x', '.bootstrap.\\x', 'docs\\..\\AGENTS.md', 'AGENTS.md::$DATA']) {
    assert.ok(lib.scopeViolation(text(p), policy, {}, 'tech-lead'), p);
  }
});

function link(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bunny-paths-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.bootstrap'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, '.bootstrap', 'policy.json'), '{}');
  let made = true;
  try { symlinkSync(join(root, '.bootstrap'), join(root, 'docs', 'j'), 'junction'); } catch { made = false; }
  return { root, made };
}

test('item 3 (real file system): a junction from docs/ to .bootstrap/ is read as .bootstrap/', (t) => {
  const { root, made } = link(t);
  if (!made) return t.skip('links cannot be made here');
  assert.equal(lib.toRepoPath(root, 'docs/j/x.mjs', root), '.bootstrap/x.mjs');
  assert.equal(lib.toRepoPath(root, join(root, 'docs', 'j', 'policy.json'), root), '.bootstrap/policy.json');
  assert.equal(lib.toRepoPath(root, 'docs/j/new-folder/deeper/x.mjs', root), '.bootstrap/new-folder/deeper/x.mjs', 'a file in a folder that does not exist yet, under the junction');
  assert.equal(lib.toRepoPath(root, 'docs/a.md', root), 'docs/a.md', 'a plain path is unchanged');
  const policy = { protected_globs: ['.bootstrap/**'] };
  assert.ok(lib.scopeViolation(lib.toRepoPath(root, 'docs/j/x.mjs', root), policy, {}, 'builder'));
});

test('item 3 (real file system): the guard refuses a write through the junction for a builder', (t) => {
  const { root, made } = link(t);
  if (!made) return t.skip('links cannot be made here');
  const repo = makeRepo(t, 'builder');
  const v = guard.decide({ tool: 'Write', filePath: join(repo, 'docs', 'ok.md'), cwd: repo });
  assert.equal(v.allow, true, 'a normal write is fine');
  // the same shape inside the invented repo: docs/j -> .bootstrap
  mkdirSync(join(repo, 'docs'), { recursive: true });
  try { symlinkSync(join(repo, '.bootstrap'), join(repo, 'docs', 'j'), 'junction'); } catch { return t.skip('links cannot be made here'); }
  const bad = guard.decide({ tool: 'Write', filePath: join(repo, 'docs', 'j', 'x.mjs'), cwd: repo });
  assert.equal(bad.allow, false);
  assert.match(bad.reason, /protected/);
  void root;
});

test('item 3: a path that cannot be read fails closed (injected file system)', () => {
  const eacces = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; };
  const eloop = () => { const e = new Error('loop'); e.code = 'ELOOP'; throw e; };
  assert.ok(refused(lib.toRepoPath('/r', 'docs/a.md', '/r', path.posix, { canonical: true, realpath: eacces })), 'permission');
  assert.ok(refused(lib.toRepoPath('/r', 'docs/a.md', '/r', path.posix, { canonical: true, realpath: eloop })), 'loop');
  // nothing exists on the way, up to the root of the drive
  const enoent = () => { const e = new Error('none'); e.code = 'ENOENT'; throw e; };
  assert.ok(refused(lib.toRepoPath('/r', 'docs/a.md', '/r', path.posix, { canonical: true, realpath: enoent })));
});

test('item 3: a path that canonicalises fine to outside the repo is still "not ours" (null)', (t) => {
  const { root } = link(t);
  assert.equal(lib.toRepoPath(root, join(tmpdir(), 'somewhere-else', 'x.txt'), root), null);
  assert.equal(lib.toRepoPath(root, '../x', root), null);
});

test('item 3: 2,000 resolutions finish inside 2 seconds', (t) => {
  const { root } = link(t);
  const t0 = Date.now();
  for (let i = 0; i < 2000; i += 1) lib.toRepoPath(root, `docs/deep/f${i}.md`, root);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

test('item 3: a refused path blocks a shell write too (shellwrites)', (t) => {
  const repo = makeRepo(t, 'builder');
  const v = guard.decide({ tool: 'Bash', command: 'echo x > "a\0b"', cwd: repo });
  assert.equal(typeof v.allow, 'boolean');
});

test('item 3 review: ".." after a junction is applied to the junction\'s target, as the file system does', (t) => {
  const { root, made } = link(t);
  if (!made) return t.skip('links cannot be made here');
  mkdirSync(join(root, '.bootstrap', 'sub'));
  writeFileSync(join(root, '.bootstrap', 'sub', 'keep.txt'), 'x');
  symlinkSync(join(root, '.bootstrap', 'sub'), join(root, 'docs', 'k'), 'junction');
  // docs/k/../policy.json is .bootstrap/policy.json on disk, though its text reads docs/policy.json
  assert.equal(lib.toRepoPath(root, 'docs/k/../policy.json', root), '.bootstrap/policy.json');
  assert.equal(lib.toRepoPath(root, 'docs/k/../../docs/a.md', root), 'docs/a.md');
});

test('item 3 review: a Windows device path that is neither a drive nor a UNC share is refused', () => {
  for (const p of ['\\\\?\\GLOBALROOT\\Device\\x', '\\\\.\\pipe\\x', '\\\\?\\Volume{abc}\\x']) assert.ok(refused(text(p)), p);
  assert.equal(text('\\\\?\\D:\\repo\\docs\\a.md'), 'docs/a.md');
});
