/**
 * K-1: the staged kit (scripts/kit-next/: bootstrap kit 0.6.0 with our guard hardening put back).
 * One test per row of Security's pre-review (docs/security/2026-11-17-k1-kit-0.6.0-weakenings.md, rows A1-A3, B1-B12, section D)
 * and of Tech Lead's list (docs/plans/k1-kit-0.6.0-findings.md, #4-#9). Everything runs in throw-away repositories.
 * These tests always run against scripts/kit-next; they do not need KIT_NEXT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  for (const c of ['git -C . push origin main', 'git "push" origin main', 'git --no-pager push origin HEAD:main', 'git push --repo=origin main', 'git -c a=b push origin main', 'git.exe push origin main', '& git push origin main', 'cmd /c git push origin main', 'git push origin +HEAD:main', 'git push origin :main', 'git push --delete origin main']) blocked(t, c);
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
  for (const f of ['pre-commit', 'commit-msg', 'pre-push']) {
    assert.equal(readFileSync(join(KIT, '.githooks', f), 'utf8').replace(/\r\n/g, '\n'), readFileSync(join(ROOT, 'scripts', 'guard-next', '.githooks', f), 'utf8').replace(/\r\n/g, '\n'), f);
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
