/**
 * K-2 (Security K2-1, K2-2, K2-3): a folder inside the project that git has not registered as a worktree of it (an old-history worktree with no policy,
 * a planted .git file with its own git directory, a nested repository) is judged by the PROJECT's policy with the role "unassigned"; protected paths
 * are matched against every worktree root of the repository; the pre-push hook never exits 0 for them. Built from Security's probe (test/probes/k1wt.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.KIT_NEXT = '1';
const { makeRepo, stage, commitAll, guard, BIN } = await import('./guard-helpers.js');
const here = dirname(fileURLToPath(import.meta.url));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const fwd = (p) => p.split('\\').join('/');

/** The project P (role chief-of-staff) with: W a session worktree (role file builder), OLD an orphan-commit worktree, EVIL a planted git directory. */
function setup(t) {
  const P = makeRepo(t, 'chief-of-staff');
  stage(P, { 'docs/a.md': 'a' });
  sh(P, 'add', '-A');
  commitAll(P, 'seed');
  const MAIN = sh(P, 'rev-parse', '--abbrev-ref', 'HEAD');
  sh(P, 'branch', 'claude/b1');
  mkdirSync(join(P, '.claude', 'worktrees'), { recursive: true });
  const W = join(P, '.claude', 'worktrees', 'b1');
  sh(P, 'worktree', 'add', '-q', W, 'claude/b1');
  writeFileSync(join(sh(W, 'rev-parse', '--absolute-git-dir'), 'bootstrap-role'), 'builder\n');
  sh(P, 'checkout', '-q', '--orphan', 'old');
  sh(P, 'rm', '-rf', '-q', '.');
  writeFileSync(join(P, 'README.txt'), 'old');
  sh(P, 'add', 'README.txt');
  sh(P, 'commit', '-q', '-m', 'old history');
  sh(P, 'checkout', '-q', '-f', MAIN);
  mkdirSync(join(P, 'vendor'), { recursive: true });
  const OLD = join(P, 'vendor', 'old');
  sh(P, 'worktree', 'add', '-q', OLD, 'old');
  const EVIL = join(P, 'vendor', 'evil');
  const EG = join(P, 'vendor', 'evilgit');
  mkdirSync(EVIL, { recursive: true });
  mkdirSync(EG, { recursive: true });
  writeFileSync(join(EVIL, '.git'), `gitdir: ${fwd(EG)}\n`);
  writeFileSync(join(EG, 'HEAD'), 'ref: refs/heads/claude/b1\n');
  writeFileSync(join(EG, 'commondir'), `${fwd(join(P, '.git'))}\n`);
  writeFileSync(join(EG, 'gitdir'), `${fwd(join(EVIL, '.git'))}\n`);
  mkdirSync(join(EVIL, '.bootstrap'), { recursive: true });
  writeFileSync(join(EVIL, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz', dev: null }, protected_globs: [], deny_all: [], releases: { dir: 'docs/r', live_pushers: ['builder', 'chief-of-staff'] }, scope_check: { commit: false, push: false } }));
  writeFileSync(join(EG, 'bootstrap-role'), 'chief-of-staff\n');
  return { P, W, OLD, EVIL };
}

const withHook = (dir, project, fn) => {
  const cwd = process.cwd();
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.chdir(dir);
  process.env.CLAUDE_PROJECT_DIR = project;
  try { return fn(); } finally { process.chdir(cwd); if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved; }
};

test('K2-1: every attack from the old-history worktree and the planted git directory is refused as "unassigned"; the session worktree keeps its own role', (t) => {
  const { P, W, OLD, EVIL } = setup(t);
  const attacks = [
    { tool: 'Bash', command: 'git push origin main' },
    { tool: 'Bash', command: 'echo x > AGENTS.md' },
    { tool: 'Write', filePath: join(P, 'AGENTS.md') },
    { tool: 'Write', filePath: join(P, '.bootstrap', 'policy.json') },
  ];
  for (const hookIn of [P, null]) {
    for (const [name, cwd, expectRole] of [['W', W, 'builder'], ['OLD', OLD, 'unassigned'], ['EVIL', EVIL, 'unassigned']]) {
      withHook(hookIn ?? cwd, P, () => {
        for (const a of attacks) {
          const v = guard.decide({ ...a, cwd });
          assert.equal(v.allow, false, `${name} (hook in ${hookIn ? 'project' : 'the cwd'}): ${a.command ?? a.filePath}`);
          if (a.command === 'git push origin main') assert.match(v.reason, new RegExp(`"${expectRole}"`), `${name}: judged as ${expectRole}`);
        }
      });
    }
  }
});

test('K2-3: from a session worktree the main checkout\'s protected files cannot be written by absolute path', (t) => {
  const { P, W } = setup(t);
  withHook(P, P, () => {
    for (const a of [
      { tool: 'Write', filePath: join(P, '.githooks', 'pre-commit') },
      { tool: 'Write', filePath: join(P, '.bootstrap', 'bin', 'guard.mjs') },
      { tool: 'Bash', command: `echo x > ${fwd(join(P, '.githooks', 'pre-commit'))}` },
      { tool: 'Bash', command: `echo x > ${fwd(join(P, 'AGENTS.md'))}` },
      { tool: 'Bash', command: `Set-Content ${fwd(join(P, '.bootstrap', 'policy.json'))} x` },
    ]) assert.equal(guard.decide({ ...a, cwd: W }).allow, false, a.command ?? a.filePath);
    // the Chief of Staff is not held back, and ordinary files of the main checkout are not blocked
    assert.equal(guard.decide({ tool: 'Write', filePath: join(P, 'docs', 'plans', 'x.md'), cwd: W }).allow, true);
  });
});

test('K2-2: the pre-push hook started from the old-history worktree or the planted git directory never exits 0 for a push to main as builder', (t) => {
  const { P, W, OLD, EVIL } = setup(t);
  const sha = sh(P, 'rev-parse', 'HEAD');
  for (const [name, cwd] of [['W', W], ['OLD', OLD], ['EVIL', EVIL]]) {
    const r = spawnSync(process.execPath, [join(BIN, 'prepush.mjs')], { cwd, input: `refs/heads/x ${sha} refs/heads/main ${'0'.repeat(40)}\n`, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '' } });
    assert.notEqual(r.status, 0, `${name}: ${r.stderr}`);
  }
  // a repository with no policy at all: the hook refuses rather than passing
  const bare = mkdtempSync(join(tmpdir(), 'bunny-nopolicy-'));
  execFileSync('git', ['init', '-q'], { cwd: bare });
  execFileSync('git', ['-c', 'user.email=a@example.test', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: bare });
  const tip = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: bare, encoding: 'utf8' }).trim();
  const none = spawnSync(process.execPath, [join(BIN, 'prepush.mjs')], { cwd: bare, input: `refs/heads/x ${tip} refs/heads/main ${'0'.repeat(40)}\n`, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '' } });
  assert.equal(none.status, 1, none.stderr);
  assert.match(none.stderr, /no \.bootstrap\/policy\.json/);
});

test('K2-1: the steps of the escape (a .git file, commondir, a role file, a policy.json under a nested folder, git worktree add) are refused for a builder', (t) => {
  const { P, W } = setup(t);
  withHook(P, P, () => {
    for (const c of ['git worktree add ../old-history HEAD~1', 'git worktree add --detach vendor/x 0000000', 'git worktree add vendor/old old', 'echo gitdir: vendor/evilgit > vendor/evil/.git', 'cd vendor/old; git push origin main']) {
      assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: W }).allow, false, c);
    }
    for (const f of [join('vendor', 'evil', '.git'), join('vendor', 'evilgit', 'commondir'), join('vendor', 'evilgit', 'bootstrap-role'), join('vendor', 'evil', '.bootstrap', 'policy.json')]) {
      assert.equal(guard.decide({ tool: 'Write', filePath: join(W, f), cwd: W }).allow, false, f);
    }
    // the Chief of Staff and Release Ops add worktrees; a nested git init or clone is allowed but judged "unassigned" from then on (covered above)
    assert.equal(guard.decide({ tool: 'Bash', command: 'git worktree add ../w claude/x', cwd: P }).allow, true);
  });
});

test('K1-2 stays closed: a nested independent repository with a policy of its own is still judged by the project', (t) => {
  const { P, W } = setup(t);
  const sub = join(P, 'sub');
  mkdirSync(join(sub, '.bootstrap'), { recursive: true });
  sh(P, 'init', '-q', sub);
  writeFileSync(join(sub, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz' }, deny_all: [] }));
  withHook(P, P, () => assert.equal(guard.decide({ tool: 'Bash', command: 'git push origin main', cwd: sub }).allow, false));
  assert.ok(here && W);
});
