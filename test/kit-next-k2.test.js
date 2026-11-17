/**
 * K-2 (Security K2-1, K2-2, K2-3): a folder inside the project that git has not registered as a worktree of it (an old-history worktree with no policy,
 * a planted .git file with its own git directory, a nested repository) is judged by the PROJECT's policy with the role "unassigned"; protected paths
 * are matched against every worktree root of the repository; the pre-push hook never exits 0 for them. Built from Security's probe (test/probes/k1wt.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// ---- the hook scripts themselves (K-2: they run the project's checks, not the folder's)
const HOOKS = join(here, '..', 'scripts', 'kit-next', '.githooks');
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;
const runHook = (name, cwd, { input = '', args = [] } = {}) => spawnSync('sh', [join(HOOKS, name), ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '' } });

test('K-2 hooks: pre-push run from a folder with a planted permissive prepush.mjs runs the PROJECT\'s checks, and fails closed when the project has none', { skip: !hasSh }, (t) => {
  const { P, W, EVIL } = setup(t);
  cpSync(BIN, join(P, '.bootstrap', 'bin'), { recursive: true }); // the project's own copy of the checks
  const sha = sh(P, 'rev-parse', 'HEAD');
  const push = `refs/heads/x ${sha} refs/heads/main ${'0'.repeat(40)}\n`;
  // a planted copy that would pass everything and leave a mark
  mkdirSync(join(EVIL, '.bootstrap', 'bin'), { recursive: true });
  writeFileSync(join(EVIL, '.bootstrap', 'bin', 'prepush.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('PLANTED_RAN', 'x'); process.exit(0);\n");
  const evil = runHook('pre-push', EVIL, { input: push });
  assert.notEqual(evil.status, 0, evil.stderr);
  assert.equal(existsSync(join(EVIL, 'PLANTED_RAN')), false, 'the planted copy did not run');
  // the same push from the legitimate worktree is judged too (a builder pushing main is refused), by the same checks
  assert.notEqual(runHook('pre-push', W, { input: push }).status, 0);
  // the project's checks missing: refused, with the reason
  rmSync(join(P, '.bootstrap', 'bin'), { recursive: true, force: true });
  const gone = runHook('pre-push', W, { input: push });
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /checks .* are missing: push refused/);
});

test('K-2 hooks: pre-commit runs the project\'s checks and fails closed when they are missing', { skip: !hasSh }, (t) => {
  const { P, W } = setup(t);
  cpSync(BIN, join(P, '.bootstrap', 'bin'), { recursive: true });
  assert.equal(runHook('pre-commit', W).status, 0, 'nothing staged: nothing to refuse');
  rmSync(join(P, '.bootstrap', 'bin'), { recursive: true, force: true });
  const gone = runHook('pre-commit', W);
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /are missing: commit refused/);
});

test('commit-msg: a message that credits Claude is refused, an ordinary one passes (the owner\'s rule survives)', { skip: !hasSh }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-msg-'));
  const msg = (text) => { const f = join(dir, `m${Math.random().toString(36).slice(2)}`); writeFileSync(f, text); return f; };
  for (const bad of ['fix\n\nCo-Authored-By: Claude Sonnet <noreply@anthropic.com>\n', 'fix\n\nco-authored-by: Anthropic\n', 'fix\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n', 'fix noreply@anthropic.com']) {
    const r = runHook('commit-msg', dir, { args: [msg(bad)] });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /credits Claude/);
  }
  for (const ok of ['fix the settings loader\n', 'W4-9: a setting for the wait\n\nCo-authored-by: A Person <a@example.test>\n']) assert.equal(runHook('commit-msg', dir, { args: [msg(ok)] }).status, 0, ok);
  assert.ok(t);
});

test('K2-4: an independent repository outside the project, and a planted .git inside it whose commondir points there, are judged by the project as "unassigned"', (t) => {
  const { P, W } = setup(t);
  const permissive = JSON.stringify({ version: 1, branches: { live: 'zzz', dev: null }, protected_globs: [], deny_all: [], releases: { dir: 'docs/r', live_pushers: ['builder', 'unassigned', 'chief-of-staff'] }, scope_check: { commit: false, push: false } });
  const X = join(mkdtempSync(join(tmpdir(), 'bunny-k2x-')), 'x');
  mkdirSync(join(X, '.bootstrap'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: X });
  writeFileSync(join(X, '.bootstrap', 'policy.json'), permissive);
  writeFileSync(join(X, '.bootstrap', 'session.json'), JSON.stringify({ role: 'chief-of-staff' }));
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: X });
  const EV2 = join(P, 'vendor', 'ev2');
  const EG2 = join(P, 'vendor', 'ev2git');
  mkdirSync(EV2, { recursive: true });
  mkdirSync(EG2, { recursive: true });
  writeFileSync(join(EV2, '.git'), `gitdir: ${fwd(EG2)}\n`);
  writeFileSync(join(EG2, 'HEAD'), 'ref: refs/heads/master\n');
  writeFileSync(join(EG2, 'commondir'), `${fwd(join(X, '.git'))}\n`);
  writeFileSync(join(EG2, 'gitdir'), `${fwd(join(EV2, '.git'))}\n`);
  withHook(P, P, () => {
    for (const cwd of [X, EV2]) {
      for (const a of [{ tool: 'Bash', command: 'git push origin main' }, { tool: 'Bash', command: 'echo x > AGENTS.md' }, { tool: 'Write', filePath: join(P, 'AGENTS.md') }]) {
        const v = guard.decide({ ...a, cwd });
        assert.equal(v.allow, false, `${cwd === X ? 'X' : 'EV2'}: ${a.command ?? a.filePath}`);
        if (a.command === 'git push origin main') assert.match(v.reason, /"unassigned"/);
      }
    }
    // writes inside the main checkout's .git, from a session worktree
    for (const f of [['worktrees', 'evil', 'gitdir'], ['worktrees', 'evil', 'HEAD'], ['worktrees', 'evil', 'commondir'], ['refs', 'heads', 'main'], ['HEAD'], ['packed-refs'], ['info', 'attributes']]) {
      assert.equal(guard.decide({ tool: 'Write', filePath: join(P, '.git', ...f), cwd: W }).allow, false, `.git/${f.join('/')}`);
    }
    assert.equal(guard.decide({ tool: 'Bash', command: `echo gitdir > ${fwd(join(P, '.git', 'worktrees', 'evil', 'gitdir'))}`, cwd: W }).allow, false);
    // an ordinary file of the project is still writable, and `git worktree prune` / `repair` stay allowed (they register nothing without the files above)
    assert.equal(guard.decide({ tool: 'Write', filePath: join(W, 'docs', 'plans', 'x.md'), cwd: W }).allow, true);
    assert.equal(guard.decide({ tool: 'Bash', command: 'git worktree prune', cwd: W }).allow, true);
  });
});

test('K-2: git clone is refused for a builder, allowed for the Chief of Staff and Release Ops; git internals are writable only by those two', (t) => {
  const { P, W } = setup(t);
  withHook(P, P, () => {
    assert.equal(guard.decide({ tool: 'Bash', command: 'git clone . vendor/c2', cwd: W }).allow, false);
    assert.equal(guard.decide({ tool: 'Bash', command: 'git clone . ../c3', cwd: P }).allow, true, 'the Chief of Staff');
    const ro = join(sh(P, 'rev-parse', '--absolute-git-dir'), 'refs', 'heads', 'x');
    assert.equal(guard.decide({ tool: 'Write', filePath: ro, cwd: W }).allow, false, 'a builder');
  });
  // Release Ops: its own worktree of the project with a role file release-ops
  const rw = join(P, '.claude', 'worktrees', 'ro');
  sh(P, 'branch', 'claude/ro');
  sh(P, 'worktree', 'add', '-q', rw, 'claude/ro');
  writeFileSync(join(sh(rw, 'rev-parse', '--absolute-git-dir'), 'bootstrap-role'), 'release-ops\n');
  withHook(P, P, () => {
    // (what a role may write beyond git's internals is its own write_globs, not this check)
    assert.equal(guard.decide({ tool: 'Write', filePath: join(P, 'AGENTS.md'), cwd: rw }).allow, false, 'but not the protected files');
    // only ref storage is theirs: the trust anchors stay protected for Release Ops too
    for (const f of ['.git/config', '.git/hooks/pre-push', '.git/commondir', '.git/bootstrap-role', '.git/worktrees/ro/commondir', '.git/worktrees/ro/gitdir', '.git/worktrees/ro/bootstrap-role', '.git/HEAD']) {
      assert.equal(guard.decide({ tool: 'Write', filePath: join(P, f), cwd: rw }).allow, false, `Release Ops may not write ${f}`);
    }
    assert.equal(guard.decide({ tool: 'Write', filePath: join(P, '.git', 'refs', 'tags', 'v1'), cwd: rw }).allow, true, 'tags');
  });
});

test('W5-1d: commands that print a sign-in token into the session are refused for EVERY role', (t) => {
  for (const role of ['builder', 'qa', 'security', 'chief-of-staff', 'release-ops', 'hotfix']) {
    const root = makeRepo(t, role);
    for (const c of ['gh auth token', 'gh config get oauth_token', 'gh config get -h github.com oauth_token', 'git credential fill', 'git credential approve', 'gh auth status $FLAG', 'gh auth status --show-token']) {
      assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: root }).allow, false, `${role}: ${c}`);
    }
    assert.equal(guard.decide({ tool: 'Bash', command: 'gh auth status', cwd: root }).allow, true, `${role}: plain gh auth status`);
  }
});

const prepushMod = await import(pathToFileURL(join(BIN, 'prepush.mjs')).href);
const policyMod = await import(pathToFileURL(join(BIN, 'lib', 'policy.mjs')).href);
const recordsMod = await import(pathToFileURL(join(BIN, 'lib', 'records.mjs')).href);
test('W5-1d: the pre-push hook refuses notes, review and release refs and the live branch in another case from a non-live role', (t) => {
  const { P, W } = setup(t);
  const policy = policyMod.loadPolicy(P);
  const tip = sh(P, 'rev-parse', 'HEAD');
  const push = (role, ref) => prepushMod.checkPush({ root: W, policy, role, localSha: tip, remoteRef: ref, remoteSha: '0'.repeat(40) });
  for (const ref of ['refs/notes/commits', 'refs/for/main', 'refs/releases/v1', 'refs/heads/Main', 'refs/heads/MAIN']) {
    assert.ok(push('builder', ref).some((e) => /may not push/.test(e)), ref);
    assert.ok(!push('release-ops', ref).some((e) => /may not push/.test(e)), );
  }
  assert.ok(!push('builder', 'refs/heads/claude/b1').some((e) => /may not push/.test(e)), 'a claude branch is fine');
});

test('K1-5: the guard has a deadline: a line of 1,999 pushes answers BLOCK in time, everyday commands are unchanged, and a decision that runs out of time is a refusal', (t) => {
  const { P, W } = setup(t);
  const shape = `${'git push origin x; '.repeat(1999)}git push origin main`;
  withHook(P, P, () => {
    const t0 = Date.now();
    const v = guard.decide({ tool: 'Bash', command: shape, cwd: W });
    assert.equal(v.allow, false);
    assert.ok(Date.now() - t0 < 8000, `answered in ${Date.now() - t0} ms`);
    // an expired deadline is a refusal, never a pass
    const late = guard.decide({ tool: 'Bash', command: 'git status', cwd: W, deadlineMs: -1 });
    assert.equal(late.allow, false);
    assert.match(late.reason, /did not finish deciding in time/);
    // everyday commands are unchanged
    for (const c of ['git status', 'git log --oneline -3', 'node --test', 'npm test', 'echo hi']) assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: W }).allow, true, c);
  });
  // the belt: the hook entry decides in a child with a timeout, and the answer for the 1,999-push shape is exit 2
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: shape }, cwd: W });
  const t1 = Date.now();
  const r = spawnSync(process.execPath, [join(BIN, 'guard.mjs')], { input: payload, encoding: 'utf8', cwd: P, env: { ...process.env, CLAUDE_PROJECT_DIR: P, BOOTSTRAP_ROLE: '' }, timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.ok(Date.now() - t1 < 10000, `the hook answered in ${Date.now() - t1} ms (the host cuts a hook off at 10 s)`);
  const ok = spawnSync(process.execPath, [join(BIN, 'guard.mjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: W }), encoding: 'utf8', cwd: P, env: { ...process.env, CLAUDE_PROJECT_DIR: P, BOOTSTRAP_ROLE: '' }, timeout: 20000 });
  assert.equal(ok.status, 0, ok.stderr);
});

// K-3 (Security's review of the landing, 88bbd53)
test('K-3 (1): a hook skip handed to an interpreter, another shell or xargs is refused; prose that mentions the flag is not', (t) => {
  const { P, W } = setup(t);
  withHook(P, P, () => {
    const refused = [
      `node -e "require('child_process').execSync('git commit --no-verify')"`,
      `python -c "import os; os.system('git commit --no-verify')"`,
      `python -c "import os; os.system('git -c core.hooksPath=/dev/null commit -m x')"`,
      'echo git commit --no-verify | sh',
      'echo git commit --no-verify | bash',
      'echo x | xargs git commit --no-verify',
      'xargs git commit --no-verify',
    ];
    for (const c of refused) assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: W }).allow, false, c);
    const prose = ['echo "never use --no-verify"', 'git commit -m "docs: explain why --no-verify is refused" --allow-empty', 'echo the flag --no-verify is refused', 'git log --oneline -3'];
    for (const c of prose) assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: W }).allow, true, c);
  });
});

test('K-3 (2): `bootstrap flow` (any subcommand) and flow-ui.mjs are the Chief of Staff only', (t) => {
  const { P, W } = setup(t);
  withHook(P, P, () => {
    for (const c of ['node .bootstrap/bin/bootstrap.mjs flow show', 'node .bootstrap/bin/bootstrap.mjs flow apply', 'node .bootstrap/bin/flow-ui.mjs', 'node ./.bootstrap/bin/flow-ui.mjs --port 5']) {
      assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: W }).allow, false, `builder: ${c}`);
      assert.equal(guard.decide({ tool: 'Bash', command: c, cwd: P }).allow, true, `chief: ${c}`);
    }
  });
});

test('K-3 (3): docs/flow-changes and docs/kit-changes are written by the Chief of Staff only', (t) => {
  const { P } = setup(t);
  const policy = policyMod.loadPolicy(P);
  const changes = (paths) => paths.map((path) => ({ status: 'A', path }));
  const run = (role, paths) => recordsMod.recordChecks({ changes: changes(paths), role, policy, readNew: () => '', readOld: () => '' });
  const paths = ['docs/flow-changes/2026-11-17-x.md', 'docs/kit-changes/2026-11-17-landing.md'];
  for (const role of ['builder', 'security', 'qa', 'release-ops']) assert.equal(run(role, paths).length, 2, role);
  assert.deepEqual(run('chief-of-staff', paths), []);
  assert.deepEqual(run('builder', ['docs/notes/x.md']), [], 'other docs are unaffected');
});

test('K-3 (4): a session with no role takes a working role only, never chief-of-staff, release-ops or hotfix', (t) => {
  const { P, OLD } = setup(t);
  withHook(P, P, () => {
    for (const r of ['chief-of-staff', 'release-ops', 'hotfix']) {
      assert.equal(guard.decide({ tool: 'Bash', command: `node .bootstrap/bin/bootstrap.mjs role ${r}`, cwd: OLD }).allow, false, `unassigned -> ${r}`);
    }
    for (const r of ['builder', 'design']) assert.equal(guard.decide({ tool: 'Bash', command: `node .bootstrap/bin/bootstrap.mjs role ${r}`, cwd: OLD }).allow, true, `unassigned -> ${r}`);
  });
});

// a slow git: a copy of node.exe named git.exe on PATH that sleeps 1 s and then runs the real git (mode "pass") or fails (mode "fail")
function slowGit(t, mode) {
  const shim = mkdtempSync(join(tmpdir(), 'bunny-slowgit-'));
  t.after(() => rmSync(shim, { recursive: true, force: true }));
  const win = process.platform === 'win32';
  cpSync(process.execPath, join(shim, win ? 'git.exe' : 'git'));
  const real = execFileSync(win ? 'where' : 'which', ['git'], { encoding: 'utf8' }).split(String.fromCharCode(10))[0].trim();
  writeFileSync(join(shim, 'slow.cjs'), [
    "const p = require('path');",
    "if (/^git(\.exe)?$/i.test(p.basename(process.execPath))) {",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);",
    mode === 'pass' ? "  const r = require('child_process').spawnSync(process.env.REAL_GIT, process.argv.slice(1), { stdio: 'inherit' }); process.exit(r.status ?? 1);" : "  process.exit(3);",
    "}",
  ].join(String.fromCharCode(10)));
  return { PATH: shim + (win ? ';' : ':') + process.env.PATH, NODE_OPTIONS: '--require ' + fwd(join(shim, 'slow.cjs')), REAL_GIT: real };
}

for (const mode of ['pass', 'fail']) {
  test(`K1-5: with every git call slow (1 s each, git ${mode === 'pass' ? 'works' : 'fails'}), 40 chained pushes answer BLOCK with "did not finish" inside 9 s, through the hook entry`, (t) => {
    const { P, W } = setup(t);
    const env = { ...process.env, ...slowGit(t, mode), CLAUDE_PROJECT_DIR: P, BOOTSTRAP_ROLE: '' };
    for (const part of ['git push --all', 'git push origin x']) {
      const shape = Array(40).fill(part).join('; ');
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [join(BIN, 'guard.mjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: shape }, cwd: W }), encoding: 'utf8', cwd: P, env, timeout: 30000 });
      const took = Date.now() - t0;
      assert.equal(r.status, 2, `${part}: ${r.stderr}`);
      assert.ok(took < 9000, `${part}: answered in ${took} ms`);
      assert.match(r.stderr, /did not finish/, `${part}: ${r.stderr}`);
    }
  });
}
