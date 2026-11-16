/**
 * W5-1 / item 4 (G1-2): sign-off and release records are authenticated at commit and at push.
 * Runs against the staged guard in scripts/guard-next/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BIN, lib, prepush, makeRepo, git, stage, commitAll, runNode } from './guard-016-helpers.js';

const PRECOMMIT = join(BIN, 'precommit.mjs');
const run = (root) => runNode(PRECOMMIT, [], root);
const sign = (role, { verdict = 'PASS', sha = 'abc1234', date = '2026-11-16', fileRole = role } = {}) => `---\nrole: ${fileRole}\nverdict: ${verdict}\nsha: ${sha}\ndate: ${date}\n---\nbody\n`;
const as = (root, role) => writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role }));

const OPEN = { 'tech-lead': 'write_globs: [docs/**, *.md]', 'chief-of-staff': 'write_globs: [docs/**, *.md]', builder: 'write_globs: []', qa: 'write_globs: [docs/**, *.md]', security: 'write_globs: [docs/**, *.md]' };
const repo = (t, role) => makeRepo(t, role, { roles: OPEN });

test('item 4: a builder or QA may not stage another role\'s sign-off, or its own with a different role inside', (t) => {
  const root = repo(t, 'builder');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa') });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /its own role/);
  git(root, 'reset', '-q');
  stage(root, { 'docs/signoffs/x/builder.md': sign('builder', { fileRole: 'qa' }) });
  assert.equal(run(root).code, 1, 'the file is builder.md but says role: qa');
});

test('item 4: a role may stage its own matching sign-off, which needs verdict, sha and date', (t) => {
  const root = repo(t, 'qa');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa') });
  assert.equal(run(root).code, 0);
  git(root, 'reset', '-q');
  stage(root, { 'docs/signoffs/x/qa.md': '---\nrole: qa\nverdict: PASS\n---\n' });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /needs a "sha"/);
  git(root, 'reset', '-q');
  stage(root, { 'docs/signoffs/x/qa.md': 'no front matter' });
  assert.equal(run(root).code, 1);
});

test('item 4: _required.md and _piece.md are the Chief of Staff\'s; Security may add a required role, never remove one', (t) => {
  const root = repo(t, 'chief-of-staff');
  stage(root, { 'docs/signoffs/x/_required.md': '---\nroles: [qa, tech-lead]\n---\n', 'docs/signoffs/x/_piece.md': '---\nname: x\n---\n' });
  assert.equal(run(root).code, 0, 'chief-of-staff');
  commitAll(root, 'seed');
  as(root, 'security');
  stage(root, { 'docs/signoffs/x/_required.md': '---\nroles: [qa, tech-lead, security]\n---\n' });
  assert.equal(run(root).code, 0, 'security adds a role');
  git(root, 'reset', '-q', '--hard');
  stage(root, { 'docs/signoffs/x/_required.md': '---\nroles: [qa]\n---\n' });
  assert.equal(run(root).code, 1, 'security removes a role');
  git(root, 'reset', '-q', '--hard');
  as(root, 'builder');
  stage(root, { 'docs/signoffs/x/_required.md': '---\nroles: [qa, tech-lead, builder]\n---\n' });
  assert.equal(run(root).code, 1, 'a builder adds a role');
});

test('item 4: the Chief of Staff records a relayed sign-off but does not flip another role\'s verdict', (t) => {
  const root = repo(t, 'qa');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa', { verdict: 'FAIL' }) });
  commitAll(root, 'qa signs');
  as(root, 'chief-of-staff');
  stage(root, { 'docs/signoffs/x/security.md': sign('security') });
  assert.equal(run(root).code, 0, 'adding a relayed sign-off');
  git(root, 'reset', '-q', '--hard');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa', { verdict: 'PASS' }) });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /does not change qa's verdict/);
  git(root, 'reset', '-q', '--hard');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa', { fileRole: 'security' }) });
  assert.equal(run(root).code, 1, 'misnamed');
});

test('item 4: deleting or renaming a sign-off is refused for everyone but the Chief of Staff', (t) => {
  const root = repo(t, 'qa');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa') });
  commitAll(root, 'seed');
  stage(root, {}, { remove: ['docs/signoffs/x/qa.md'] });
  assert.equal(run(root).code, 1, 'delete by qa');
  git(root, 'reset', '-q', '--hard');
  git(root, 'mv', 'docs/signoffs/x/qa.md', 'docs/signoffs/x/security.md');
  assert.equal(run(root).code, 1, 'rename qa.md to security.md');
  git(root, 'reset', '-q', '--hard');
  as(root, 'chief-of-staff');
  stage(root, {}, { remove: ['docs/signoffs/x/qa.md'] });
  assert.equal(run(root).code, 0, 'the Chief of Staff may delete (the message line is checked at push)');
});

test('item 4: release records are the Chief of Staff\'s unless policy names a pattern for the role', (t) => {
  const root = repo(t, 'builder');
  stage(root, { 'docs/releases/v1.md': '---\nshas: [abc]\n---\n' });
  assert.equal(run(root).code, 1);
  as(root, 'chief-of-staff');
  assert.equal(run(root).code, 0);
  const custom = makeRepo(t, 'release-ops', { roles: OPEN, policy: { records: { globs: ['docs/signoffs/**', 'docs/releases/**'], writers: ['chief-of-staff'], owner_patterns: { 'release-ops': ['docs/releases/*-release-ops.md'] } } } });
  stage(custom, { 'docs/releases/v1-release-ops.md': 'x' });
  assert.equal(run(custom).code, 0, 'its own pattern');
  git(custom, 'reset', '-q');
  stage(custom, { 'docs/releases/v1.md': 'x' });
  assert.equal(run(custom).code, 1, 'not its pattern');
});

test('item 4: other files and ordinary docs are untouched by the record check; the switch turns it off', (t) => {
  const root = repo(t, 'builder');
  stage(root, { 'docs/notes.md': 'x', 'src/a.js': 'y' });
  assert.equal(run(root).code, 0);
  const off = makeRepo(t, 'builder', { roles: OPEN, policy: { records_check: false } });
  stage(off, { 'docs/signoffs/x/qa.md': sign('qa') });
  assert.equal(run(off).code, 0);
});

// ---- push time

function push(root, role, remoteSha = '0'.repeat(40)) {
  return prepush.checkPush({ root, policy: lib.loadPolicy(root), role, localSha: git(root, 'rev-parse', 'HEAD'), remoteRef: 'refs/heads/claude/x', remoteSha });
}

test('item 4 push: a forged sign-off committed with the hooks skipped is caught', (t) => {
  const root = repo(t, 'builder');
  stage(root, { 'docs/a.md': 'base' });
  commitAll(root, 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa') }); // a builder writing QA's sign-off; commit made without running the hook
  commitAll(root, 'forged');
  const errs = push(root, 'builder', base);
  assert.ok(errs.some((e) => /qa\.md/.test(e) && /its own role/.test(e)), errs.join('\n'));
  assert.deepEqual(push(root, 'release-ops', base), [], 'release-ops moves other roles\' commits: not asked');
});

test('item 4 push: a sign-off deleted by the Chief of Staff needs the removal line in the commit message', (t) => {
  const root = repo(t, 'chief-of-staff');
  stage(root, { 'docs/signoffs/x/qa.md': sign('qa') });
  commitAll(root, 'seed');
  const base = git(root, 'rev-parse', 'HEAD');
  stage(root, {}, { remove: ['docs/signoffs/x/qa.md'] });
  commitAll(root, 'remove a sign-off');
  assert.ok(push(root, 'chief-of-staff', base).some((e) => /removed-by/.test(e)));
  git(root, 'reset', '-q', '--soft', 'HEAD~1');
  commitAll(root, 'remove a sign-off\n\nremoved-by: chief-of-staff, reason: re-signed on a new sha');
  assert.deepEqual(push(root, 'chief-of-staff', base).filter((e) => /removed-by/.test(e)), []);
});

test('item 4 push: completeSignoffs does not count a sign-off whose file name and role differ, and names it', (t) => {
  const root = repo(t, 'chief-of-staff');
  const policy = lib.loadPolicy(root);
  stage(root, {
    'docs/signoffs/p/_required.md': '---\nroles: [qa, security]\n---\n',
    'docs/signoffs/p/qa.md': sign('qa'),
    'docs/signoffs/p/security.md': sign('security', { fileRole: 'qa' }), // security.md that says role: qa
  });
  commitAll(root, 'p');
  const forged = [];
  const done = prepush.completeSignoffs(root, git(root, 'rev-parse', 'HEAD'), policy, forged);
  assert.deepEqual(done, [], 'security did not really sign');
  assert.deepEqual(forged, ['docs/signoffs/p/security.md']);
});

test('item 4: a normal sign-off flow end to end is unaffected (own role, own file, then a push)', (t) => {
  const root = repo(t, 'qa');
  stage(root, { 'docs/signoffs/p/qa.md': sign('qa') });
  assert.equal(run(root).code, 0);
  commitAll(root, 'qa signs');
  assert.deepEqual(push(root, 'qa'), []);
});
