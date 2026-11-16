/**
 * W5-1 / item 6 (G1-4, G1-5): a dynamic push target, a hidden environment-variable name, the role file in the worktree's
 * private git directory, and removing a protected folder or the folder above one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { guard, lib, makeRepo, BIN, runNode } from './guard-016-helpers.js';

const verdict = (t, command, role = 'builder') => guard.decide({ tool: 'Bash', command, cwd: makeRepo(t, role) });
const allowed = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, true, `should allow (${role ?? 'builder'}): ${c}\n${v.reason ?? ''}`); };
const denied = (t, c, role) => assert.equal(verdict(t, c, role).allow, false, `should deny (${role ?? 'builder'}): ${c}`);

test('item 6: a push whose target is a variable or a substitution is refused for a builder; named branches are not', (t) => {
  denied(t, 'git push origin $B');
  denied(t, 'git push origin "$B"');
  denied(t, 'git push origin ${B:-main}');
  denied(t, 'git push origin $(git rev-parse --abbrev-ref HEAD)');
  denied(t, 'git push origin HEAD:$BRANCH');
  allowed(t, 'git push origin claude/builder-x');
  allowed(t, 'git push -u origin HEAD');
  allowed(t, 'git push origin $B', 'release-ops');
});

test('item 6: the name of an environment variable cannot be a variable', (t) => {
  denied(t, '$R=BOOTSTRAP_ROLE; export $R=chief-of-staff');
  denied(t, '${N}=x git status');
  denied(t, 'env $N=x git status');
  allowed(t, 'FOO=1 git status');
  allowed(t, 'echo $HOME');
  allowed(t, 'env FOO=1 git status');
});

test('item 6: removing or moving a protected folder, or the folder above one, is a protected write', (t) => {
  for (const c of ['rm -rf .githooks', 'rm -rf .bootstrap', 'rm -r .bootstrap/', 'mv .githooks x', 'mv .bootstrap /tmp/b', 'rm -rf .git', 'rm -rf .git/hooks', 'rm -rf .claude',
    'Remove-Item -Recurse -Force .githooks', 'Move-Item .bootstrap ..\\b', 'rm .githooks/pre-push']) denied(t, c);
  allowed(t, 'rm -rf node_modules');
  allowed(t, 'rm -rf test-results');
  allowed(t, 'rm -f docs/old.md');
  allowed(t, 'git restore .');
  allowed(t, 'rm -rf .githooks', 'chief-of-staff');
});

test('item 6: holdsProtected is true for a protected root or anything above it, false otherwise', (t) => {
  const root = makeRepo(t, 'builder');
  const policy = lib.loadPolicy(root);
  for (const rel of ['.bootstrap', '.githooks', '.git', '.git/hooks', '.claude', '.BOOTSTRAP']) assert.equal(lib.holdsProtected(rel, policy), true, rel);
  for (const rel of ['docs', 'src', '.github', '.gitignore', '.bootstrap-notes', '']) assert.equal(lib.holdsProtected(rel, policy), false, rel);
});

test('item 6: the role comes from the worktree\'s private file, then the environment; a mismatch is said, and the file wins', (t) => {
  const root = makeRepo(t, 'builder');
  const file = lib.roleFile(root);
  assert.ok(file && /[\\/]\.git[\\/](worktrees[\\/][^\\/]+[\\/])?bootstrap-role$/.test(file), 'the file lives in the private git directory, not among the working files');
  assert.equal(lib.currentRole(root), 'builder', 'no file: session.json');
  writeFileSync(file, 'qa\n');
  assert.equal(lib.currentRole(root), 'qa', 'the file wins over session.json');
  const saved = process.env.BOOTSTRAP_ROLE;
  process.env.BOOTSTRAP_ROLE = 'chief-of-staff';
  try { assert.equal(lib.currentRole(root), 'qa', 'the file wins over the environment'); } finally { if (saved === undefined) delete process.env.BOOTSTRAP_ROLE; else process.env.BOOTSTRAP_ROLE = saved; }
});

test('item 6: bootstrap role writes that file, and a role set only in the environment is still the fallback', (t) => {
  const root = makeRepo(t, null);
  const r = runNode(join(BIN, 'bootstrap.mjs'), ['role', 'builder'], root);
  assert.equal(r.code, 0, r.out);
  const file = lib.roleFile(root);
  assert.equal(existsSync(file) && readFileSync(file, 'utf8').trim(), 'builder');
  const bare = makeRepo(t, null);
  const saved = process.env.BOOTSTRAP_ROLE;
  process.env.BOOTSTRAP_ROLE = 'tech-lead';
  try { assert.equal(lib.currentRole(bare), 'tech-lead'); } finally { if (saved === undefined) delete process.env.BOOTSTRAP_ROLE; else process.env.BOOTSTRAP_ROLE = saved; }
  void execFileSync;
});
