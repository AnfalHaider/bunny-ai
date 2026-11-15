/**
 * G-1 / A1: the commit-time and push-time scope check on changed paths (Tech Lead's spec a012c6f).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BIN, NEXT, lib, prepush, makeRepo, git, stage, commitAll, runNode } from './guard-helpers.js';

const PRECOMMIT = join(BIN, 'precommit.mjs');
const runPrecommit = (root, env) => runNode(PRECOMMIT, [], root, env);

test('A1 allow: tech-lead stages a doc and a root README', (t) => {
  const root = makeRepo(t, 'tech-lead');
  stage(root, { 'docs/x.md': 'a', 'README.md': 'b' });
  assert.equal(runPrecommit(root).code, 0);
});

test('A1 allow: a role with no write_globs stages any non-protected file', (t) => {
  const root = makeRepo(t, 'builder');
  stage(root, { 'src/a.js': 'a' });
  assert.equal(runPrecommit(root).code, 0);
});

test('A1 allow: the Chief of Staff stages AGENTS.md and hook files', (t) => {
  const root = makeRepo(t, 'chief-of-staff');
  stage(root, { 'AGENTS.md': 'a', '.githooks/pre-push': 'b' });
  assert.equal(runPrecommit(root).code, 0);
});

test('A1 deny: tech-lead stages a source file, and the message names it', (t) => {
  const root = makeRepo(t, 'tech-lead');
  stage(root, { 'src/a.js': 'a', 'docs/ok.md': 'b' });
  const r = runPrecommit(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/a\.js/);
  assert.doesNotMatch(r.out, /docs\/ok\.md/);
});

test('A1 deny: a non-chief role stages protected files', (t) => {
  for (const role of ['builder', 'qa', 'tech-lead']) {
    const root = makeRepo(t, role);
    stage(root, { '.githooks/pre-push': 'x' });
    assert.equal(runPrecommit(root).code, 1, `${role} .githooks`);
    git(root, 'reset', '-q');
    stage(root, { 'AGENTS.md': 'x' });
    assert.equal(runPrecommit(root).code, 1, `${role} AGENTS.md`);
    git(root, 'reset', '-q');
    stage(root, { '.bootstrap/policy.json': '{}' });
    assert.equal(runPrecommit(root).code, 1, `${role} policy.json`);
  }
});

test('A1 deny: deleting a protected file, and renaming across scope, are both caught', (t) => {
  const root = makeRepo(t, 'chief-of-staff');
  stage(root, { 'AGENTS.md': 'a', 'docs/a.md': 'a' });
  commitAll(root);
  writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role: 'tech-lead' }));
  stage(root, {}, { remove: ['AGENTS.md'] });
  assert.equal(runPrecommit(root).code, 1, 'delete AGENTS.md as tech-lead');
  git(root, 'reset', '-q');
  mkdirSync(join(root, 'src'), { recursive: true });
  git(root, 'mv', 'docs/a.md', 'src/a.md');
  const r = runPrecommit(root);
  assert.equal(r.code, 1, 'rename docs/a.md -> src/a.md');
  assert.match(r.out, /src\/a\.md/);
});

test('A1 malformed: a missing or unreadable role means unassigned: no scope, protected still denied', (t) => {
  const root = makeRepo(t, null);
  stage(root, { 'src/a.js': 'a' });
  assert.equal(runPrecommit(root).code, 0, 'no role: no scope');
  stage(root, { '.githooks/x': 'a' });
  assert.equal(runPrecommit(root).code, 1, 'no role: protected still denied');
  const root2 = makeRepo(t, 'tech-lead');
  writeFileSync(join(root2, '.bootstrap', 'session.json'), '{not json');
  stage(root2, { 'src/a.js': 'a' });
  assert.equal(runPrecommit(root2).code, 0, 'unparsable session file: unassigned');
});

test('A1 malformed: spaces and non-ASCII paths, an empty commit, and write_globs: []', (t) => {
  const root = makeRepo(t, 'tech-lead');
  stage(root, { 'docs/my notes/été ✓.md': 'a' });
  assert.equal(runPrecommit(root).code, 0);
  stage(root, { 'src/sp ace/é.js': 'a' });
  const r = runPrecommit(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /sp ace/);
  assert.equal(runPrecommit(makeRepo(t, 'tech-lead')).code, 0, 'nothing staged');
  const open = makeRepo(t, 'builder');
  stage(open, { 'anything/at/all.bin': 'a' });
  assert.equal(runPrecommit(open).code, 0);
});

test('A1 fails open, loudly, on an internal error (a policy file that is not JSON)', (t) => {
  const root = makeRepo(t, 'tech-lead');
  writeFileSync(join(root, '.bootstrap', 'policy.json'), '{broken');
  stage(root, { 'src/a.js': 'a' });
  const r = runPrecommit(root);
  assert.equal(r.code, 0, 'no role scope can be known without the policy: not blocked, but loud');
  assert.match(r.out, /pre-commit: internal error/i);
  stage(root, { '.githooks/x': 'a' });
  const p = runPrecommit(root);
  assert.equal(p.code, 1, 'the built-in protected paths are still held when the policy file is unreadable');
  assert.match(p.out, /\.githooks\/x/);
});

test('A1: the hook file runs the checker, with LF endings', () => {
  const hook = readFileSync(join(NEXT, '.githooks', 'pre-commit'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh/);
  assert.match(hook, /precommit\.mjs/);
  assert.ok(!hook.includes('\r'), 'LF only, so sh can run it');
});

// ---- the pre-push backstop

function pushOf(root, role, { remoteSha = '0'.repeat(40) } = {}) {
  return prepush.checkPush({
    root, policy: lib.loadPolicy(root), role, localSha: git(root, 'rev-parse', 'HEAD'),
    remoteRef: 'refs/heads/claude/some-branch', remoteSha,
  });
}

test('A1 push: a non-merge commit outside the pusher\'s scope is refused; a docs commit is not', (t) => {
  const root = makeRepo(t, 'tech-lead');
  stage(root, { 'docs/a.md': 'a' });
  commitAll(root, 'docs');
  assert.deepEqual(pushOf(root, 'tech-lead'), []);
  stage(root, { 'src/a.js': 'a' });
  commitAll(root, 'code');
  const errs = pushOf(root, 'tech-lead');
  assert.ok(errs.some((e) => /src\/a\.js/.test(e) && /outside/i.test(e)), errs.join('\n'));
});

test('A1 push: protected paths are refused for a builder; chief-of-staff and release-ops move others\' work', (t) => {
  const root = makeRepo(t, 'builder');
  stage(root, { '.githooks/pre-push': 'x' });
  commitAll(root, 'hook');
  assert.ok(pushOf(root, 'builder').some((e) => /\.githooks\/pre-push/.test(e)));
  assert.deepEqual(pushOf(root, 'chief-of-staff'), []);
  assert.deepEqual(pushOf(root, 'release-ops'), [], 'release-ops batches other roles\' commits (policy.scope_check.push_exempt_roles)');
});

test('A1 push: a merge commit is skipped (the merged work is not the pusher\'s)', (t) => {
  const root = makeRepo(t, 'tech-lead');
  stage(root, { 'docs/a.md': 'a' });
  commitAll(root, 'base');
  const main = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(root, 'checkout', '-q', '-b', 'side');
  stage(root, { 'src/side.js': 'a' });
  commitAll(root, 'side code by another role');
  git(root, 'checkout', '-q', main);
  stage(root, { 'docs/b.md': 'b' });
  commitAll(root, 'docs on main');
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const base = git(root, 'rev-parse', 'HEAD^1');
  const errs = pushOf(root, 'tech-lead', { remoteSha: base });
  assert.ok(!errs.some((e) => /merge side/.test(e)), errs.join('\n'));
});
