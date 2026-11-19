/**
 * K-1: the staged kit (scripts/kit-next/: bootstrap kit 0.6.0 with our guard hardening put back).
 * One test per row of Security's pre-review (docs/security/2026-11-17-k1-kit-0.6.0-weakenings.md, rows A1-A3, B1-B12, section D)
 * and of Tech Lead's list (docs/plans/k1-kit-0.6.0-findings.md, #4-#9). Everything runs in throw-away repositories.
 * These tests always run against scripts/kit-next; they do not need KIT_NEXT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'scripts', 'kit-next');
const BIN = join(KIT, '.bootstrap', 'bin');
const url = (p) => pathToFileURL(p).href;
const guard = await import(url(join(BIN, 'guard.mjs')));
const prepush = await import(url(join(BIN, 'prepush.mjs')));
const policyLib = await import(url(join(BIN, 'lib', 'policy.mjs')));
delete process.env.BOOTSTRAP_ROLE;
process.env.CLAUDE_CONFIG_DIR ||= mkdtempSync(join(tmpdir(), 'bunny-claude-config-'));

const sh = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const ROLES = { builder: 'write_globs: []', qa: 'write_globs: [docs/**, test/**]', 'chief-of-staff': 'write_globs: [docs/**, *.md]', 'release-ops': 'write_globs: [docs/**, *.md]', security: 'write_globs: [docs/**]' };

function makeRepo(t, role = 'builder', files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-kit-next-'));
  sh(['init', '-q', '-b', 'main'], root);
  sh(['config', 'user.email', 'a@example.test'], root);
  sh(['config', 'user.name', 'Invented'], root);
  mkdirSync(join(root, '.bootstrap', 'roles'), { recursive: true });
  copy(join(KIT, '.bootstrap', 'policy.json'), join(root, '.bootstrap', 'policy.json'));
  for (const [id, scope] of Object.entries(ROLES)) writeFileSync(join(root, '.bootstrap', 'roles', `${id}.md`), `---\nid: ${id}\n${scope}\n---\n`);
  for (const [f, text] of Object.entries(files)) put(root, f, text);
  if (role) writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role }));
  return root;
}
function copy(from, to) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, readFileSync(from)); }
function put(root, rel, text) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); }
function commit(root, msg) { sh(['add', '-A'], root); sh(['commit', '-q', '-m', msg, '--no-verify'], root); return sh(['rev-parse', 'HEAD'], root); }
const run = (cli, args, cwd, env = {}) => spawnSync(process.execPath, [join(BIN, cli), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const ask = (root, command, role) => guard.decide({ tool: 'Bash', command, cwd: root, ...(role ? {} : {}) });
const blocked = (t, command, role = 'builder') => { const root = makeRepo(t, role); const v = ask(root, command); assert.equal(v.allow, false, `should block (${role}): ${command}`); return v.reason; };
const allowed = (t, command, role = 'builder') => { const v = ask(makeRepo(t, role), command); assert.equal(v.allow, true, `should allow (${role}): ${command}\n${v.reason ?? ''}`); };
const writeBlocked = (t, rel, role = 'builder') => { const root = makeRepo(t, role); const v = guard.decide({ tool: 'Write', filePath: join(root, rel), cwd: root }); assert.equal(v.allow, false, `Write should be blocked: ${rel}`); };

test('the staged kit is the 0.6.0 kit: flow, kit apply, family and the helper cap are all there', () => {
  const boot = readFileSync(join(BIN, 'bootstrap.mjs'), 'utf8');
  for (const word of ["'kit'", 'upgrade', 'family', 'flowApply', 'kitApply']) assert.ok(boot.includes(word), word);
  const g = readFileSync(join(BIN, 'guard.mjs'), 'utf8');
  assert.ok(/helperCheck/.test(g) && /AGENT_TOOLS/.test(g), 'the helper cap is in the guard');
  assert.ok(existsSync(join(BIN, 'lib', 'flow.mjs')) && existsSync(join(BIN, 'flow-ui.mjs')));
  assert.ok(policyLib.LIVE_NAMES?.includes('main') && typeof policyLib.detectBranches === 'function', 'detectBranches from 0.6.0');
});

test('no conflict markers anywhere in the staged files', () => {
  for (const f of ['guard.mjs', 'bootstrap.mjs', 'prepush.mjs', 'precommit.mjs', 'lib/policy.mjs', 'lib/shellrules.mjs']) {
    assert.doesNotMatch(readFileSync(join(BIN, f), 'utf8'), /^(<{7}|={7}|>{7})( |$)/m, f);
  }
});

test('A1: pushes are read through the tokenizer (git -C, quotes, global options, --repo=)', (t) => {
  for (const c of ['git -C . push origin main', 'git "push" origin main', 'git --no-pager push origin HEAD:main', 'git push --repo=origin main', 'git -c a=b push origin main', 'git.exe push origin main', '& git push origin main', 'cmd /c git push origin main', 'git push origin +HEAD:main', 'git push origin :main', 'git push --delete origin main', 'git push origin HEAD:heads/main', 'git push origin HEAD:refs/heads/main', 'git push origin +HEAD:heads/main', 'git push origin main:heads/main']) blocked(t, c);
  allowed(t, 'git push origin claude/builder-a-k1');
});

test('A2: protected paths in any case, with Windows tricks (Write tool and shell)', (t) => {
  for (const rel of ['.BOOTSTRAP/policy.json', '.Githooks/pre-push', 'agents.md', 'AGENTS.MD', '.bootstrap/Roles/builder.md']) writeBlocked(t, rel);
  if (process.platform === 'win32') for (const rel of ['.bootstrap./policy.json', 'AGENTS.md::$DATA', '.bootstrap /policy.json']) writeBlocked(t, rel);
  writeBlocked(t, 'Docs/Signoffs/x/QA.md', 'builder');
  const root = makeRepo(t, 'builder');
  assert.equal(guard.decide({ tool: 'Write', filePath: join(root, 'docs', 'plans', 'x.md'), cwd: root }).allow, true, 'ordinary docs stay writable');
  assert.equal(guard.decide({ tool: 'Write', filePath: join(tmpdir(), 'elsewhere.txt'), cwd: root }).allow, true, 'outside the repo is not ours to police');
});

test('A3: the CLI refuses ids that are paths (signoff, approve, require, piece), and writes nothing', (t) => {
  for (const [role, cmds] of [['qa', [['signoff', '../../.bootstrap/roles', '--role', 'builder', '--verdict', 'PASS', '--note', 'npm test: 12 passed; checked src/app.js:1'], ['signoff', '..', '--verdict', 'PASS'], ['signoff', 'x/y', '--verdict', 'PASS']]],
    ['chief-of-staff', [['approve', '../x', '--word', 'go', '--words', 'w', '--question', 'q', '--said-at', 'now'], ['require', '../x', 'qa'], ['require', 'b-1', '../qa'], ['piece', '../x', '--lane', 'normal']]]]) {
    for (const args of cmds) {
      const root = makeRepo(t, role);
      const before = readFileSync(join(root, '.bootstrap', 'roles', 'builder.md'), 'utf8');
      const r = run('bootstrap.mjs', args, root);
      assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.stdout}${r.stderr}`);
      assert.equal(readFileSync(join(root, '.bootstrap', 'roles', 'builder.md'), 'utf8'), before, 'the role brief was not overwritten');
    }
  }
  const ok = run('bootstrap.mjs', ['signoff', 'b-1', '--verdict', 'PASS', '--note', 'npm test: 12 passed; checked src/app.js:1', '--sha', 'abc1234'], makeRepo(t, 'qa'));
  assert.equal(ok.status, 0, ok.stderr);
});

test('B1: shell writes into protected folders are refused', (t) => {
  // an interpreter one-liner (node -e, python -c) is not read by the shell seatbelt; the pre-commit hook is the authoritative check there (A1)
  for (const c of ['echo x > .bootstrap/policy.json', 'Set-Content AGENTS.md "x"', 'Remove-Item .githooks/pre-push', 'rm -rf .bootstrap', 'cp x .githooks/pre-commit', 'git checkout-index -f -- .bootstrap/policy.json']) blocked(t, c);
});

test('B2: tags and gh', (t) => {
  for (const c of ['git push origin refs/tags/v1', 'git push origin --tags', 'git push origin :refs/tags/v1', 'gh release create v9 x.zip', 'gh gist create a.txt', 'gh repo create x --public', 'gh api -X POST repos/o/r/releases', 'gh auth token']) blocked(t, c);
  for (const role of ['builder', 'qa', 'security', 'chief-of-staff', 'release-ops']) blocked(t, 'gh auth status --show-token', role);
});

test('B3: label, remote and ref moves', (t) => {
  for (const c of ['git branch -f main HEAD', 'git branch -f Main HEAD', 'git symbolic-ref HEAD refs/heads/main', 'git update-ref refs/heads/main HEAD', 'git worktree add -B main ../w', 'git remote set-url origin https://example.test/x.git', 'git fetch origin +main:main', 'git push --mirror', 'git push --all', 'git push https://example.test/x.git main']) blocked(t, c);
});

test('B4/B10: the role cannot be changed from a command, in any spelling', (t) => {
  for (const c of ['export BOOTSTRAP_ROLE=chief-of-staff', '$env:BOOTSTRAP_ROLE="chief-of-staff"', 'setx BOOTSTRAP_ROLE chief-of-staff', 'set BOOTSTRAP_ROLE=chief-of-staff', "[Environment]::SetEnvironmentVariable('BOOTSTRAP_ROLE','chief-of-staff')", 'echo {"role":"chief-of-staff"} > .bootstrap/session.json', 'env BOOTSTRAP_ROLE=chief-of-staff node x.js']) blocked(t, c);
  assert.equal(typeof policyLib.roleFile, 'function', 'the role file in the git directory is kept');
});

test('B5: our commit hooks are staged unchanged (no Claude credit, record and scope checks at commit)', () => {
  // K-2: commit-msg needs nothing from the repository and is byte-identical; pre-push and pre-commit now run the checks of the main checkout (test/kit-next-k2.test.js runs them)
  const same = (f) => readFileSync(join(KIT, '.githooks', f), 'utf8').replace(/\r\n/g, '\n') === readFileSync(join(ROOT, 'scripts', 'guard-next', '.githooks', f), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(same('commit-msg'), true, 'commit-msg');
  for (const f of ['pre-push', 'pre-commit']) {
    const text = readFileSync(join(KIT, '.githooks', f), 'utf8');
    assert.match(text, /--git-common-dir/, f);
    assert.doesNotMatch(text, /--show-toplevel/, f);
    assert.match(text, /refused\./, `${f} fails closed`);
  }
  assert.ok(existsSync(join(BIN, 'precommit.mjs')));
});

test('B6: skipping hooks, in every spelling', (t) => {
  for (const c of ['git commit --no-verify -m x', 'git commit -n -m x', 'git commit -an -m x', 'git commit --no-ver -m x', 'git -c core.hooksPath=x commit -m x', 'git -c CORE.HOOKSPATH=x commit -m x', 'git config CORE.HOOKSPATH x', 'git config core.hookspath x', 'git push --no-verify origin x', 'git hook run pre-commit', 'git -c alias.ci=commit ci']) blocked(t, c);
  allowed(t, 'git commit -m "explain why --no-verify is refused"');
});

test('B7: a command run inside a nested repository is still judged by the outer policy', (t) => {
  const root = makeRepo(t, 'builder');
  const sub = join(root, 'sub');
  mkdirSync(sub);
  sh(['init', '-q'], sub);
  const here = process.cwd();
  process.chdir(root); // the hook runs in the project folder
  try {
    assert.equal(guard.decide({ tool: 'Bash', command: 'git push origin main', cwd: sub }).allow, false, 'the nested repository has no policy, the outer one still judges');
    assert.equal(guard.decide({ tool: 'Write', filePath: join(sub, '..', '.bootstrap', 'policy.json'), cwd: sub }).allow, false);
  } finally { process.chdir(here); }
  // not bootstrapped anywhere = silently allowed, as before
  const loose = mkdtempSync(join(tmpdir(), 'bunny-loose-'));
  sh(['init', '-q'], loose);
  assert.equal(guard.decide({ tool: 'Bash', command: 'git push origin main', cwd: loose }).allow, true);
});

test('B8: the upgrade never adds a broad git push allow rule (nor touches .claude/settings.json)', () => {
  const boot = readFileSync(join(BIN, 'bootstrap.mjs'), 'utf8');
  assert.doesNotMatch(boot, /want = \[[^\]]*git push:\*/, 'no auto-allow list');
  assert.doesNotMatch(boot, /writeFileSync\(p, JSON\.stringify\(s, null, 2\)[^;]*\);[\s\S]{0,80}settings\.json/);
  assert.ok(!/KIT_UPGRADE_DIRS = \[[^\]]*settings\.json/.test(boot) && !/KIT_UPGRADE_GLOBS = \[[^\]]*settings\.json/.test(readFileSync(join(BIN, 'prepush.mjs'), 'utf8')));
});

test('Tech Lead #4: unassigned is not the owner at a terminal; a role is not signed for another', (t) => {
  const none = makeRepo(t, null);
  for (const args of [['upgrade'], ['kit', 'apply', '--words', 'w', '--question', 'q'], ['piece', 'b-1', '--lane', 'normal'], ['approve', 'b-1', '--word', 'go', '--words', 'w', '--question', 'q', '--said-at', 'n'], ['signoff', 'b-1', '--verdict', 'PASS', '--role', 'qa', '--note', 'npm test: 12 passed; checked src/app.js:1']]) {
    assert.notEqual(run('bootstrap.mjs', args, none).status, 0, args.join(' '));
  }
  const chief = makeRepo(t, 'chief-of-staff');
  assert.notEqual(run('bootstrap.mjs', ['signoff', 'b-2', '--verdict', 'PASS', '--role', 'qa', '--note', 'npm test: 12 passed; checked src/app.js:1'], chief).status, 0, 'the Chief of Staff does not sign for qa either');
});

// ---- push checks: a throw-away repository with a "remote" tip and a pushed change

function pushCase(t, change, signers = ['qa', 'tech-lead', 'librarian', 'chief-of-staff'], { record = true } = {}) {
  const root = makeRepo(t, 'release-ops', { 'README.md': '# x\n', 'src/app.js': 'a\n' });
  const base = commit(root, 'base');
  change(root);
  const code = commit(root, 'change');
  for (const r of signers) put(root, `docs/signoffs/b-1/${r}.md`, `---\npiece: b-1\nrole: ${r}\nsha: ${code}\nverdict: PASS\ndate: 2026-11-17\n---\n\nnpm test: 12 passed; checked src/app.js:1\n`);
  put(root, 'docs/notes.md', 'notes\n');
  if (record) put(root, 'docs/releases/v1.md', `---\nscope: v1\nshas: [${code}]\nowner_words: "push to main"\nquestion: "Release?"\nsaid_at: 2026-11-17\n---\n\n## Pre-release check\nnpm test: 12 passed\n`);
  const tip = commit(root, 'record');
  const errors = prepush.checkPush({ root, policy: policyLib.loadPolicy(root), role: 'release-ops', localSha: tip, remoteRef: 'refs/heads/main', remoteSha: base });
  return { errors, root };
}

test('Tech Lead #7: a normally signed piece still pushes to main on the upgraded kit (no flow.json, no lanes)', (t) => {
  const { errors, root } = pushCase(t, (r) => put(r, 'src/app.js', 'b\n'));
  assert.equal(existsSync(join(root, '.bootstrap', 'flow.json')), false);
  assert.deepEqual(errors, []);
  const unsigned = pushCase(t, (r) => put(r, 'src/app.js', 'b\n'), ['qa']);
  assert.ok(unsigned.errors.some((e) => /no complete sign-off/.test(e)), unsigned.errors.join(' | '));
});

test('Security B12 / Tech Lead #5: a change to the guard needs Security on the same commit; a kit record does not replace it', (t) => {
  const guardChange = (r) => put(r, '.bootstrap/bin/guard.mjs', '// changed\n');
  const without = pushCase(t, guardChange);
  assert.ok(without.errors.some((e) => /security/i.test(e) || /no complete sign-off/.test(e)), without.errors.join(' | '));
  const withSec = pushCase(t, guardChange, ['qa', 'tech-lead', 'librarian', 'chief-of-staff', 'security']);
  assert.deepEqual(withSec.errors, []);
  for (const f of ['.githooks/pre-push', '.bootstrap/roles/builder.md', '.claude/settings.json']) {
    const r = pushCase(t, (root) => put(root, f, 'x\n'));
    assert.ok(r.errors.length > 0, `${f}: ${r.errors.join(' | ')}`);
  }
});

test('Tech Lead #6: .md files that steer the agents are code at push, ordinary docs are not', (t) => {
  for (const f of ['.bootstrap/roles/builder.md', 'AGENTS.md', 'CLAUDE.md']) {
    const r = pushCase(t, (root) => put(root, f, 'x\n'), ['qa'], { record: false });
    assert.ok(r.errors.some((e) => /no complete sign-off|release record/.test(e)), `${f}: ${r.errors.join(' | ')}`);
  }
  const docs = pushCase(t, (root) => put(root, 'docs/plans/x.md', 'x\n'), [], { record: false });
  assert.deepEqual(docs.errors, [], 'a docs-only push needs nothing');
});

test('G1-2: a sign-off whose file name and role disagree is not counted', (t) => {
  const r = pushCase(t, (root) => put(root, 'src/app.js', 'b\n'), ['qa', 'tech-lead', 'chief-of-staff']);
  assert.ok(r.errors.length > 0);
});

test('Tech Lead #9 (written down, not code): the plugin copy of the guard runs beside ours', () => {
  assert.ok(true, 'see scripts/kit-next/README.md, "What a plain upgrade leaves running"');
});

test('review round: a planted policy in a nested repository does not switch the guard off; registry and DWIM refspec spellings; guard paths in any case', (t) => {
  // a nested repository that carries a permissive policy of its own is still judged by the project
  const root = makeRepo(t, 'builder');
  const sub = join(root, 'sub');
  mkdirSync(join(sub, '.bootstrap'), { recursive: true });
  sh(['init', '-q'], sub);
  writeFileSync(join(sub, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz' }, deny_all: [] }));
  const here = process.cwd();
  process.chdir(root);
  try { assert.equal(guard.decide({ tool: 'Bash', command: 'git push origin main', cwd: sub }).allow, false); } finally { process.chdir(here); }
  // the Windows registry and persistent environment
  for (const c of ['reg add HKCU\\Environment /v BOOTSTRAP_ROLE /d chief-of-staff', 'reg.exe add "HKCU\\Environment" /v X /d y', 'Set-ItemProperty -Path HKCU:\\Environment -Name BOOTSTRAP_ROLE -Value chief-of-staff']) blocked(t, c);
  // the destination as git reads it, and the other ways to write a branch label from a fetch
  for (const c of ['git fetch origin +main:heads/main', 'git fetch origin main:refs/heads/Main', 'git fetch origin +refs/heads/*:refs/heads/*', 'git fetch --stdin', 'git -c remote.origin.fetch=+x:main fetch origin']) blocked(t, c);
});

test('review round: guard paths in another case still need Security', (t) => {
  const r = pushCase(t, (root) => put(root, '.BOOTSTRAP/BIN/guard.mjs', '// changed\n'));
  assert.ok(r.errors.length > 0, r.errors.join(' | '));
});

test('Security K1-1: role ids and every other id are plain names; reserved Windows names and a trailing dot are refused', (t) => {
  const bad = ['../../AGENTS', '../../docs/a', 'x.', 'x ', 'con', 'nul', 'prn', 'aux', 'com1', 'lpt9', 'CON.txt', 'a/b', 'a\\b'];
  for (const id of bad) {
    const root = makeRepo(t, 'chief-of-staff');
    assert.notEqual(run('bootstrap.mjs', ['role', id], root).status, 0, `role ${id}`);
    assert.notEqual(run('bootstrap.mjs', ['signoff', id, '--verdict', 'PASS', '--note', 'npm test: 12 passed; checked src/app.js:1'], root).status, 0, `signoff ${id}`);
    assert.notEqual(run('bootstrap.mjs', ['require', id, 'qa'], root).status, 0, `require ${id}`);
    assert.notEqual(run('bootstrap.mjs', ['require', 'b-1', id], root).status, 0, `require role ${id}`);
    assert.notEqual(run('bootstrap.mjs', ['piece', id, '--lane', 'normal'], root).status, 0, `piece ${id}`);
    assert.equal(existsSync(join(root, 'docs', 'a.md')) || existsSync(join(root, 'AGENTS.md')), false, 'nothing was written outside the record folders');
  }
  // the guard reads the same words and refuses them before the command runs
  for (const c of ['node .bootstrap/bin/bootstrap.mjs role ../../AGENTS', 'node .bootstrap/bin/bootstrap.mjs role con']) blocked(t, c, 'unassigned');
  // a plain id of a role that has a brief is still fine; one without a brief is not
  const ok = makeRepo(t, null);
  assert.equal(run('bootstrap.mjs', ['role', 'qa'], ok).status, 0);
  assert.notEqual(run('bootstrap.mjs', ['role', 'nobody'], makeRepo(t, null)).status, 0, 'no brief, no role');
});

test('Security K1-2: the nested-repository check holds wherever the hook runs (CLAUDE_PROJECT_DIR, a cwd inside the nested repo, no project cwd)', (t) => {
  const root = makeRepo(t, 'builder');
  const sub = join(root, 'sub');
  mkdirSync(join(sub, '.bootstrap'), { recursive: true });
  sh(['init', '-q'], sub);
  const attacks = ['git push origin main', 'git -C . push origin main', 'git commit --no-verify -m x', 'echo x > ../.bootstrap/policy.json', 'gh release create v9', 'git push origin HEAD:heads/main'];
  const here = process.cwd();
  const savedEnv = process.env.CLAUDE_PROJECT_DIR;
  try {
    for (const where of [root, sub, tmpdir()]) {
      process.chdir(where);
      for (const planted of [false, true]) {
        if (planted) writeFileSync(join(sub, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz' }, deny_all: [] }));
        else rmSync(join(sub, '.bootstrap', 'policy.json'), { force: true }); // not left over from the planted round
        for (const withEnv of [true, false]) {
          if (withEnv) process.env.CLAUDE_PROJECT_DIR = root; else delete process.env.CLAUDE_PROJECT_DIR;
          // without the variable, a planted policy in the nested repo is the nearest one: only the variable defends that case (written in the README)
          if (planted && !withEnv) continue;
          for (const c of attacks) {
            const v = guard.decide({ tool: 'Bash', command: c, cwd: sub });
            assert.equal(v.allow, false, `cwd=${where === root ? 'project' : where === sub ? 'nested' : 'elsewhere'} planted=${planted} env=${withEnv}: ${c}`);
          }
        }
      }
    }
  } finally {
    process.chdir(here);
    if (savedEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = savedEnv;
  }
});

test('Security 714a0a8: git\'s default fetch refspec is fine; a glob that can write a branch label or a tag is not', (t) => {
  allowed(t, "git fetch origin 'refs/heads/*:refs/remotes/origin/*'");
  allowed(t, 'git fetch origin +refs/heads/*:refs/remotes/origin/*');
  allowed(t, 'git fetch origin main:refs/remotes/origin/main');
  for (const c of ['git fetch origin +refs/heads/*:refs/heads/*', 'git fetch origin "refs/heads/*:refs/tags/*"', 'git fetch origin x:refs/tags/v1', 'git fetch origin main:main', 'git fetch origin +main:heads/main', 'git fetch origin refs/heads/*:refs/remotes/origin/../../heads/*']) blocked(t, c);
});

test('QA: a command over 64 KB, or with over 2,000 parts, is refused before anything is parsed, without hanging (well inside the deadline of the guard); everyday commands still pass', (t) => {
  const root = makeRepo(t, 'builder');
  const reason = /too long or has too many parts.*64 KB.*2000 commands.*Write tool/;
  const timed = (command, role) => { const t0 = Date.now(); const v = guard.decide({ tool: 'Bash', command, cwd: role ? makeRepo(t, role) : root }); return { v, ms: Date.now() - t0 }; };
  // "No hang" is not a wall-clock budget on a busy PC: the refusal reason (with "64 KB", which the 6 s deadline's message lacks) proves the pre-parse path answered.
  // The time limit is only a backstop: under the guard's 6 s deadline and the host's 10 s hook cut, and far from the 23-31 s the full parse took. Before the size check, the guard spawns git to place the repository, which takes about 1 s on a loaded PC.
  const NO_HANG_MS = 5000;
  // QA's shape: 21,000 "git status;" and a push to main (about 250 KB)
  const shape = timed(`${'git status; '.repeat(21_000)}git push origin main`);
  assert.equal(shape.v.allow, false);
  assert.match(shape.v.reason, reason);
  assert.ok(shape.ms < NO_HANG_MS, `answered in ${shape.ms} ms`);
  // few bytes, many commands
  const many = timed(`${'a;'.repeat(2500)}git push origin main`);
  assert.equal(many.v.allow, false);
  assert.match(many.v.reason, reason);
  assert.ok(many.ms < NO_HANG_MS, `answered in ${many.ms} ms`);
  // over the size limit
  const big = timed(`echo ${'x'.repeat(70 * 1024)}`);
  assert.equal(big.v.allow, false);
  assert.match(big.v.reason, reason);
  assert.ok(big.ms < NO_HANG_MS, `answered in ${big.ms} ms`);
  assert.equal(timed(`git push origin main ${'x '.repeat(500_000)}`).v.allow, false);
  // everyday: a 12 KB sign-off note, and 1,500 commands, are still read
  const note = guard.decide({ tool: 'Bash', command: `node .bootstrap/bin/bootstrap.mjs signoff s-1 --verdict PASS --sha abc1234 --note "${'checked src/app.js:1 and the gate output. '.repeat(280)}"`, cwd: makeRepo(t, 'qa') });
  assert.doesNotMatch(note.reason ?? '', reason, 'a 12 KB sign-off note is not refused for its size');
  const some = guard.decide({ tool: 'Bash', command: 'git status; '.repeat(1500).trim(), cwd: root });
  assert.doesNotMatch(some.reason ?? '', reason, '1,500 commands are still read');
});

test('the kit works from a worktree nested inside the main checkout: its own role and policy, not the main checkout\'s', (t) => {
  const main = makeRepo(t, 'chief-of-staff');
  put(main, 'README.md', 'x\n');
  commit(main, 'base');
  const wt = join(main, '.claude', 'worktrees', 'b1');
  sh(['worktree', 'add', '-q', '-b', 'claude/b1', wt], main);
  writeFileSync(join(wt, '.bootstrap', 'session.json'), JSON.stringify({ role: 'builder' }));
  // a permissive policy.json planted in the worktree changes nothing: the project's policy judges
  writeFileSync(join(wt, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz' }, deny_all: [] }));
  const here = process.cwd();
  const savedEnv = process.env.CLAUDE_PROJECT_DIR;
  try {
    for (const dir of [wt, main]) {
      process.chdir(wt);
      process.env.CLAUDE_PROJECT_DIR = dir; // the host may name the main checkout as the project
      // the builder in its own worktree is the builder: a push to main is refused, and the reason names "builder"
      const push = guard.decide({ tool: 'Bash', command: 'git push origin main', cwd: wt });
      assert.equal(push.allow, false);
      assert.match(push.reason, /builder/, push.reason);
      // and an ordinary command is allowed
      assert.equal(guard.decide({ tool: 'Bash', command: 'git status', cwd: wt }).allow, true);
    }
  } finally {
    process.chdir(here);
    if (savedEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = savedEnv;
  }
});

test('the plugin\'s own 0.6.0 guard (it runs beside ours) allows everyday commands against the staged policy and still blocks a force push', async (t) => {
  // the plugin turns every deny_all entry into a regex: a non-string entry became /[object Object]/ and blocked every command
  const policy = JSON.parse(readFileSync(join(KIT, '.bootstrap', 'policy.json'), 'utf8'));
  for (const k of ['deny_all', 'legacy_deny_all', 'destructive_commands']) assert.ok((policy[k] || []).every((e) => typeof e === 'string'), `${k} is plain strings`);
  const plugin = await import(pathToFileURL(join(ROOT, 'test', 'fixtures', 'plugin-guard-0.6.0', 'bin', 'guard.mjs')).href);
  for (const role of ['builder', 'chief-of-staff', 'qa']) {
    const root = makeRepo(t, role);
    for (const c of ['echo hi', 'git status', 'node --test', 'git log --oneline -3', 'npm test']) {
      const v = plugin.decide({ tool: 'Bash', command: c, cwd: root });
      assert.equal(v.allow, true, `${role}: ${c}: ${v.reason ?? ''}`);
    }
    assert.equal(plugin.decide({ tool: 'Bash', command: 'git push --force origin claude/x', cwd: root }).allow, false, `${role}: a force push`);
  }
  // and ours reads the whole-line patterns from deny_all_whole
  assert.ok(Array.isArray(policy.deny_all_whole) && policy.deny_all_whole.some((p) => /GIT_CONFIG/.test(p)));
  blocked(t, 'GIT_CONFIG_COUNT=1 git status');
});
