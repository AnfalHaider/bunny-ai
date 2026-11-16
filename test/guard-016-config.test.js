/**
 * W5-1 / items 2 (G1-3): git config and alias writes, a git directory pointed elsewhere, and subcommands that are not git's own.
 * Runs against the staged guard in scripts/guard-next/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { guard, makeRepo } from './guard-016-helpers.js';

const decide = (root, command) => guard.decide({ tool: 'Bash', command, cwd: root });
const verdict = (t, command, role = 'builder') => decide(makeRepo(t, role), command);
const denied = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, false, `should deny (${role ?? 'builder'}): ${c}`); return v.reason; };
const allowed = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, true, `should allow (${role ?? 'builder'}): ${c}\n${v.reason ?? ''}`); };

test('item 2 deny: alias, include and program-running keys, written for a builder', (t) => {
  for (const c of [
    'git config alias.ci "commit -n"',
    'git config alias.p "!git push origin main"',
    'git config alias.m "merge"',
    'git config include.path ../x',
    'git config includeIf.gitdir:/a/.path ../x',
    'git config remote.origin.push HEAD:main',
    'git config remote.origin.mirror true',
    'git config remote.origin.url https://example.test/x.git',
    'git config push.default matching',
    'git config branch.main.pushRemote other',
    'git config core.fsmonitor "x"',
    'git config core.sshCommand "x"',
    'git config core.editor "x"',
    'git config core.pager "x"',
    'git config core.askPass "x"',
    'git config core.attributesFile x',
    'git config credential.helper store',
    'git config credential.https://x.helper store',
    'git config url.https://a/.insteadOf https://b/',
    'git config --global core.hooksPath x',
    'git config --global user.name x',
    'git config --system user.name x',
    'git config --file other alias.x y',
    'git config --add remote.origin.push HEAD:main',
    'git -c alias.ci="commit -n" ci',
    'git -c remote.origin.url=x fetch',
  ]) denied(t, c);
});

test('item 2 allow: reads, identity keys, harmless aliases, and the same words as plain text', (t) => {
  for (const c of [
    'git config --get alias.ci', 'git config -l', 'git config --list --show-origin', 'git config user.email a@b', 'git config user.name "A B"',
    'git config alias.st status', 'git config alias.co checkout', 'git config core.autocrlf true', 'git config --get remote.origin.url', 'git config remote.origin.url',
    'git config --unset user.signingkey',
    'git commit -m "document git config alias.ci"', "echo 'git config include.path x'",
  ]) allowed(t, c);
});

test('item 2: --git-dir, --work-tree and the GIT_* location variables are refused', (t) => {
  for (const c of [
    'git --git-dir=other/.git commit -m x', 'git --git-dir other/.git status', 'git --work-tree=x status', 'git -C d --git-dir=x log',
    'GIT_DIR=x git commit -m y', 'GIT_WORK_TREE=x git status', 'GIT_INDEX_FILE=x git commit -m y', 'GIT_COMMON_DIR=x git status',
    'export GIT_DIR=x', '$env:GIT_DIR = "x"', 'env GIT_DIR=x git status',
  ]) denied(t, c);
  allowed(t, 'git -C d status');
  allowed(t, 'echo "GIT_DIR is a variable"');
});

test('item 2: commit-tree and update-ref on a branch or tag are refused, reading refs is not', (t) => {
  denied(t, 'git commit-tree HEAD^{tree} -m x');
  denied(t, 'git update-ref refs/heads/main abc123');
  denied(t, 'git update-ref -d refs/tags/v1');
  allowed(t, 'git rev-parse HEAD');
  allowed(t, 'git show-ref --heads');
  allowed(t, 'git symbolic-ref HEAD');
});

test('item 2: an unknown git subcommand is refused; a known one, and an alias of a safe command, is not', (t) => {
  assert.match(denied(t, 'git frobnicate --now'), /unknown subcommand/);
  denied(t, 'git-evil commit');
  allowed(t, 'git status');
  allowed(t, 'git worktree list');
  allowed(t, 'git lfs ls-files');
  const root = makeRepo(t, 'builder');
  execFileSync('git', ['config', 'alias.st', 'status'], { cwd: root });
  execFileSync('git', ['config', 'alias.ci', 'commit -n'], { cwd: root });
  execFileSync('git', ['config', 'alias.sh', '!echo hi'], { cwd: root });
  execFileSync('git', ['config', 'alias.back', 'ci'], { cwd: root });
  assert.equal(decide(root, 'git st').allow, true, 'alias.st=status');
  const ci = decide(root, 'git ci -m x');
  assert.equal(ci.allow, false);
  assert.match(ci.reason, /alias "ci"/);
  assert.equal(decide(root, 'git sh').allow, false, 'a shell alias');
  assert.equal(decide(root, 'git back -m x').allow, false, 'an alias of an alias that skips the hook, read to depth 3');
});

test('item 2: the Chief of Staff and release-ops are not held to these rules (their limits are the pre-push scope check)', (t) => {
  for (const role of ['chief-of-staff', 'release-ops']) {
    allowed(t, 'git config alias.ci "commit"', role);
    allowed(t, 'git config --global user.name x', role);
    allowed(t, 'git frobnicate', role);
    allowed(t, 'GIT_DIR=x git status', role);
  }
  // the skip flag itself stays refused for everyone
  assert.equal(verdict(t, 'git commit -n -m x', 'chief-of-staff').allow, false);
});
