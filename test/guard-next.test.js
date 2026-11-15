/**
 * G-1: the staged guard (scripts/guard-next/) against Tech Lead's spec a012c6f.
 * The staged files mirror .bootstrap/ and .githooks/; the Chief of Staff copies them into place
 * after review. Nothing here reads or writes the real profile or the live .bootstrap/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { join } from 'node:path';

import { lib, guard, makeRepo } from './guard-helpers.js';

const write = (root, filePath) => guard.decide({ tool: "Write", filePath, cwd: root });

// ============================================================ B: cross-drive paths

const W = path.win32;
const WROOT = 'D:\\proj\\repo';

test('B: paths inside the repo come back relative, whatever the slashes, dots or drive-letter case', () => {
  const rel = (p, cwd = WROOT) => lib.toRepoPath(WROOT, p, cwd, W);
  assert.equal(rel('docs/a.md'), 'docs/a.md');
  assert.equal(rel('D:\\proj\\repo\\docs\\a.md'), 'docs/a.md');
  assert.equal(rel('D:/proj/repo/./docs\\a.md'), 'docs/a.md');
  assert.equal(rel('d:\\proj\\repo\\docs\\a.md'), 'docs/a.md');
  assert.equal(rel('docs/a.md', undefined), 'docs/a.md', 'a relative path with no cwd is read against the root');
});

test('B: paths outside the repo come back null, so the guard leaves them alone', () => {
  const rel = (p) => lib.toRepoPath(WROOT, p, WROOT, W);
  for (const p of ['C:\\Users\\x\\a.txt', 'D:\\other\\x.txt', '..\\x', '..', '\\\\srv\\sh\\a.md', 'D:\\proj\\repo-two\\a.md', '../../x']) {
    assert.equal(rel(p), null, p);
  }
});

test('B: an in-repo file whose name starts with two dots is not mistaken for "outside"', () => {
  const rel = (p) => lib.toRepoPath(WROOT, p, WROOT, W);
  assert.equal(rel('..foo.md'), '..foo.md');
  assert.equal(rel('docs\\..bar.md'), 'docs/..bar.md');
});

test('B: protected paths stay protected through case changes and ..\\ detours', () => {
  const rel = (p) => lib.toRepoPath(WROOT, p, WROOT, W);
  assert.equal(rel('docs\\..\\.bootstrap\\policy.json'), '.bootstrap/policy.json');
  const policy = { protected_globs: ['.bootstrap/**'] };
  assert.ok(lib.scopeViolation(rel('.BOOTSTRAP\\Policy.JSON'), policy, {}, 'tech-lead'), 'different casing still protected');
});

test('B: Windows name tricks do not hide a protected path (trailing dots and spaces, :streams)', () => {
  const rel = (p) => lib.toRepoPath(WROOT, p, WROOT, W);
  assert.equal(rel('.bootstrap.\\policy.json'), '.bootstrap/policy.json');
  assert.equal(rel('.bootstrap \\policy.json'), '.bootstrap/policy.json');
  assert.equal(rel('.bootstrap\\policy.json.'), '.bootstrap/policy.json');
  assert.equal(rel('.bootstrap\\policy.json::$DATA'), '.bootstrap/policy.json');
  assert.equal(rel('AGENTS.md:stream'), 'AGENTS.md');
  const policy = { protected_globs: ['.bootstrap/**', 'AGENTS.md'] };
  for (const p of ['.bootstrap.\\policy.json', 'AGENTS.md::$DATA', 'AGENTS.md.']) {
    assert.ok(lib.scopeViolation(rel(p), policy, {}, 'builder'), p);
  }
});

test('B: malformed paths never throw', () => {
  const rel = (p) => lib.toRepoPath(WROOT, p, WROOT, W);
  assert.equal(rel(''), null);
  assert.equal(rel('a\0b'), null);
  assert.equal(typeof rel('docs/' + 'x'.repeat(300) + '.md'), 'string');
  assert.equal(rel('NUL'), 'NUL');
  assert.equal(lib.toRepoPath(WROOT, undefined, WROOT, W), null);
});

test('B: decide() allows a write outside the repo and still polices ..foo files inside it', (t) => {
  const root = makeRepo(t, 'tech-lead');
  const outside = process.platform === 'win32' ? 'C:\\Users\\invented\\x.txt' : '/invented/x.txt';
  assert.equal(write(root, process.platform === 'win32' ? outside.replace('C:', root.startsWith('C:') ? 'D:' : 'C:') : outside).allow, true, 'another drive / outside');
  assert.equal(write(root, join(root, '..foo.js')).allow, false, '..foo.js is inside the repo and outside tech-lead\'s scope');
  assert.equal(write(root, join(root, '..foo.md')).allow, true, '..foo.md is a doc');
  assert.equal(write(root, join(root, '.bootstrap', 'policy.json')).allow, false);
  assert.equal(write(root, join(root, '.BOOTSTRAP', 'policy.json')).allow, false, 'case-insensitive file systems');
});
