/**
 * K-5 (HIGH, Security signs): guard follow-ups, staged in scripts/kit-next/. Spec: docs/plans/K-5-guard-followups.md (Tech Lead), docs/security/2026-11-16-g1-guard-review.md (G1-3..G1-5).
 *   K5-T  one git question is asked once per decision (a git that is slow costs the same as a fast one) and the deadline counts from the process start
 *   K5-1  reading core.hooksPath is allowed, every write of it stays refused
 *   K5-3  an assignment inside $( ... ) is not "a variable as a name"; a name built from a variable still is
 *   K5-4  git -C <another work tree> <writes> is refused for roles that may not push live; reads stay open
 *   K5-F  role overrides come from the COMMITTED flow.json of the project's checkout, never from a working-tree file
 *   K5-C  the company layer by path must be inside the project (no absolute path, no ".."), and is read from the committed copy
 *   K5-E  the flow editor writes only the three known role states and a whole-number helper count into the page
 *   K5-D  the staged kit's policy.json is not a "policy that decides what the guard believes" (the Chief of Staff could write it but not commit it)
 *   G1-3..G1-5 (Security's older rows) are refused for builders: listed here as a regression table, since K-1 put them back
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.KIT_NEXT = '1';
const { makeRepo, stage, commitAll, guard, lib, BIN, NEXT } = await import('./guard-helpers.js');
const here = dirname(fileURLToPath(import.meta.url));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const fwd = (p) => p.split('\\').join('/');
const flowLib = await import(pathToFileURL(join(BIN, 'lib', 'flow.mjs')).href);
const policyLib = await import(pathToFileURL(join(BIN, 'lib', 'policy.mjs')).href);
const rules = await import(pathToFileURL(join(BIN, 'lib', 'shellrules.mjs')).href);

const ROLES = { builder: 'write_globs: []', 'tech-lead': 'write_globs: [docs/**, *.md]', qa: 'write_globs: [docs/**, test/**]', 'chief-of-staff': 'write_globs: [docs/**, *.md]', 'release-ops': 'write_globs: [docs/**]' };

/** A decision as `role`, inside the repository, with the host naming the project (CLAUDE_PROJECT_DIR). */
function decideAs(root, role, input) {
  writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role }));
  const cwd = process.cwd();
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.chdir(root);
  process.env.CLAUDE_PROJECT_DIR = root;
  try { return guard.decide({ cwd: root, ...input }); } finally { process.chdir(cwd); if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved; }
}
const bash = (root, role, command) => decideAs(root, role, { tool: 'Bash', command });
const seeded = (t, role = 'builder') => { const root = makeRepo(t, role, { roles: ROLES }); stage(root, { 'a.txt': 'x\n' }); commitAll(root, 'seed'); return root; };

test('K5-1: reading core.hooksPath is allowed; every write of it, a value, a flag we cannot read, -c and the env spelling stay refused', (t) => {
  const root = seeded(t);
  const KEY = ['core', 'hooksPath'].join('.');
  const allowed = [`git config ${KEY}`, `git config --get ${KEY}`, `git config --get-all ${KEY}`, `git config --local --get ${KEY}`, `git config --show-origin --get ${KEY}`, 'git config --list', 'git config user.name'];
  const refused = [`git config ${KEY} x`, `git config --add ${KEY} x`, `git config --replace-all ${KEY} x`, `git config --unset ${KEY}`, `git config --unset-all ${KEY}`, `git config --edit`, `git config --global ${KEY} /tmp/h`,
    `git -c ${KEY}=/tmp/h commit -m x`, `git config --file other.cfg ${KEY} x`, `git config --frobnicate ${KEY}`, `echo $(git config ${KEY} /tmp/h)`, `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=${KEY} GIT_CONFIG_VALUE_0=x git status`];
  for (const role of ['builder', 'tech-lead', 'qa']) {
    for (const c of allowed) assert.equal(bash(root, role, c).allow, true, `${role}: ${c}`);
    for (const c of refused.filter((x) => x !== 'git config --edit')) assert.equal(bash(root, role, c).allow, false, `${role}: ${c}`);
  }
  assert.equal(rules.configIsRead(['--edit']), false);
  assert.equal(rules.configIsRead([KEY]), true);
  assert.equal(rules.configIsRead([KEY, 'x']), false);
});

test('K5-3: an assignment inside a command substitution is allowed; a name built from a variable is still refused', (t) => {
  const root = seeded(t);
  const allowed = ['echo $(FOO=1 date)', 'echo $(A=1 B=2 date)', 'X=$(A=1 git status)', 'echo `FOO=1 date`', 'echo "$f vsP1=$a"'];
  const refused = ['echo $($N=1 date)', 'echo $(env $N=x date)', 'R=BOOTSTRAP_ROLE; env $R=chief-of-staff git status', 'env $N=x date', 'echo $( $(X=1 y)=z )', 'echo ${N}=x', '$N=1'];
  for (const role of ['builder', 'tech-lead', 'qa']) {
    for (const c of allowed) assert.equal(bash(root, role, c).allow, true, `${role}: ${c}`);
    for (const c of refused) assert.equal(bash(root, role, c).allow, false, `${role}: ${c}`);
  }
  assert.equal(rules.dynamicAssignmentName('$(FOO=1'), false);
  assert.equal(rules.dynamicAssignmentName('$R=BOOTSTRAP_ROLE'), true);
});

test('K5-4: git -C at another work tree of the project is refused for writes (commit, merge, reset, add, branch ...) for roles that may not push live; reads and the roles that may are unchanged', (t) => {
  const P = makeRepo(t, 'chief-of-staff', { roles: ROLES });
  stage(P, { 'docs/a.md': 'a' });
  commitAll(P, 'seed');
  sh(P, 'branch', 'claude/b1');
  mkdirSync(join(P, '.claude', 'worktrees'), { recursive: true });
  const W = join(P, '.claude', 'worktrees', 'b1');
  sh(P, 'worktree', 'add', '-q', W, 'claude/b1');
  writeFileSync(join(sh(W, 'rev-parse', '--absolute-git-dir'), 'bootstrap-role'), 'builder\n');
  const asBuilder = (command, cwd = W) => { const c = process.cwd(); const s = process.env.CLAUDE_PROJECT_DIR; process.chdir(cwd); process.env.CLAUDE_PROJECT_DIR = P; try { return guard.decide({ tool: 'Bash', command, cwd }); } finally { process.chdir(c); if (s === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = s; } };
  const main = fwd(P);
  for (const c of [`git -C ${main} commit -am x`, `git -C ${main} commit --allow-empty -m x`, `git -C ${main} merge claude/b1`, `git -C ${main} reset HEAD~1`, `git -C ${main} add -A`, `git -C ${main} branch zzz`, `git -C ${main} stash`, `git -C ${main} tag v1`, `git -C ${main} update-ref refs/heads/x HEAD`, `git -C ${main}/docs commit -m x`, `git -C ../../.. commit -m x`]) {
    assert.equal(asBuilder(c).allow, false, c);
  }
  for (const c of [`git -C ${main} status`, `git -C ${main} log -1`, `git -C ${main} diff`, `git -C ${main} show HEAD`, `git -C ${main} rev-parse HEAD`, `git -C ${fwd(W)} commit -m x`, 'git status', 'git commit -m x']) {
    assert.equal(asBuilder(c).allow, true, c);
  }
  assert.match(asBuilder(`git -C ${main} commit -m x`).reason, /another work tree/);
  // the Chief of Staff (a live pusher) is not held back
  writeFileSync(join(P, '.bootstrap', 'session.json'), JSON.stringify({ role: 'chief-of-staff' }));
  writeFileSync(join(sh(W, 'rev-parse', '--absolute-git-dir'), 'bootstrap-role'), 'chief-of-staff\n');
  assert.equal(asBuilder(`git -C ${main} commit -m x`).allow, true);
});

test('K5-T: a slow git costs one answer per question: the decisions equal a fast git, git is started only a handful of times, and a decision that really runs out of time is still a refusal', (t) => {
  const root = seeded(t);
  // a git shim that waits 700 ms per call, in front of the real one
  const shimDir = mkdtempSync(join(tmpdir(), 'bunny-gitshim-'));
  t.after(() => rmSync(shimDir, { recursive: true, force: true }));
  const real = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  writeFileSync(join(shimDir, 'git-slow.mjs'), `import { spawnSync } from 'node:child_process';\nconst end = Date.now() + 700;\nwhile (Date.now() < end) { /* wait */ }\nconst r = spawnSync(${JSON.stringify(real)}, process.argv.slice(2), { stdio: 'inherit' });\nprocess.exit(r.status ?? 1);\n`);
  if (process.platform === 'win32') writeFileSync(join(shimDir, 'git.cmd'), `@echo off\r\n"${process.execPath}" "${join(shimDir, 'git-slow.mjs')}" %*\r\n`);
  else { writeFileSync(join(shimDir, 'git'), `#!/bin/sh\nexec "${process.execPath}" "${join(shimDir, 'git-slow.mjs')}" "$@"\n`); chmodSync(join(shimDir, 'git'), 0o755); }
  const cases = [
    ['builder', 'git status', true], ['builder', 'git log -1', true], ['builder', 'npm test', true], ['builder', 'git config alias.ci "commit -n"', false],
    ['builder', 'echo x > AGENTS.md', false], ['tech-lead', 'git commit -m x', true],
  ];
  const run = (env, role, command) => {
    writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role }));
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root });
    const started = Date.now();
    const r = spawnSync(process.execPath, [join(BIN, 'guard.mjs')], { cwd: root, input: payload, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, BOOTSTRAP_ROLE: '', ...env } });
    return { code: r.status, ms: Date.now() - started, out: `${r.stdout}${r.stderr}` };
  };
  const slowEnv = { PATH: `${shimDir}${delimiter}${process.env.PATH}` };
  for (const [role, command, ok] of cases) {
    const fast = run({}, role, command);
    const slow = run(slowEnv, role, command);
    const inProcess = decideAs(root, role, { tool: 'Bash', command }).allow;
    assert.equal(inProcess, ok, `in process: ${role}: ${command}`);
    assert.equal(fast.code === 0, inProcess, `the hook (a child process, with its belt) decides like the function: ${role}: ${command}: ${fast.out}`);
    assert.equal(slow.code, fast.code, `a slow git gives the same decision: ${role}: ${command}: ${slow.out}`);
    assert.ok(slow.ms < 9000, `the whole decision from process start stays under the belt (${slow.ms} ms): ${command}`);
  }
  // the number of git starts for one decision is small and fixed (memoised per decision)
  const probe = join(shimDir, 'count.mjs');
  writeFileSync(probe, `import { pathToFileURL } from 'node:url';\nconst guard = await import(pathToFileURL(${JSON.stringify(join(BIN, 'guard.mjs'))}).href);\nconst policy = await import(pathToFileURL(${JSON.stringify(join(BIN, 'lib', 'policy.mjs'))}).href);\nlet spawned = 0;\nconst real = policy.setDeadline;\nconst out = guard.decide({ tool: 'Bash', command: 'git status', cwd: process.cwd(), deadlineMs: 20000 });\nconsole.log(JSON.stringify({ allow: out.allow }));\n`);
  const spawnsPerDecision = (() => {
    // count with a wrapper: a PATH shim that appends a line per call
    const log = join(shimDir, 'calls.log');
    writeFileSync(join(shimDir, 'git-count.mjs'), `import { appendFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nappendFileSync(${JSON.stringify(log)}, 'x\\n');\nconst r = spawnSync(${JSON.stringify(real)}, process.argv.slice(2), { stdio: 'inherit' });\nprocess.exit(r.status ?? 1);\n`);
    const countDir = mkdtempSync(join(tmpdir(), 'bunny-gitcount-'));
    t.after(() => rmSync(countDir, { recursive: true, force: true }));
    if (process.platform === 'win32') writeFileSync(join(countDir, 'git.cmd'), `@echo off\r\n"${process.execPath}" "${join(shimDir, 'git-count.mjs')}" %*\r\n`);
    else { writeFileSync(join(countDir, 'git'), `#!/bin/sh\nexec "${process.execPath}" "${join(shimDir, 'git-count.mjs')}" "$@"\n`); chmodSync(join(countDir, 'git'), 0o755); }
    writeFileSync(log, '');
    run({ PATH: `${countDir}${delimiter}${process.env.PATH}` }, 'builder', 'git status');
    return readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  })();
  assert.ok(spawnsPerDecision <= 14, `git was started ${spawnsPerDecision} times for one ordinary decision (the bound is 14)`);
  // a decision that really runs out of time is a refusal with the message, and the in-process counter is reset between decisions
  const late = guard.decide({ tool: 'Bash', command: 'git status', cwd: root, deadlineMs: -1 });
  assert.equal(late.allow, false);
  assert.match(late.reason, /did not finish deciding in time/);
  guard.decide({ tool: 'Bash', command: 'git status', cwd: root });
  assert.equal(policyLib.gitSpawnCount(), 0, 'nothing is kept after a decision');
});

test('K5-T: git answers are asked once per decision inside it, and not remembered after it', (t) => {
  const root = seeded(t);
  policyLib.setDeadline(5000);
  const first = policyLib.git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const n1 = policyLib.gitSpawnCount();
  const second = policyLib.git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  assert.equal(second, first);
  assert.equal(policyLib.gitSpawnCount(), n1, 'the second identical read did not start git');
  // something that can change is never remembered
  policyLib.git(['status', '--porcelain'], root);
  const n2 = policyLib.gitSpawnCount();
  policyLib.git(['status', '--porcelain'], root);
  assert.equal(policyLib.gitSpawnCount(), n2 + 1, 'status is asked again each time');
  policyLib.setDeadline(null);
  policyLib.setDeadline(5000);
  policyLib.git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  assert.equal(policyLib.gitSpawnCount(), 1, 'a new decision starts with nothing remembered');
  policyLib.setDeadline(null);
});

test('K5-T: the deadline can count from the process start, so start-up time is taken out of the budget, not added to it', () => {
  policyLib.setDeadline(60_000, { fromProcessStart: true });
  assert.doesNotThrow(() => policyLib.checkDeadline());
  policyLib.setDeadline(1, { fromProcessStart: true }); // the test process has run for longer than 1 ms
  assert.throws(() => policyLib.checkDeadline(), /took too long/);
  policyLib.setDeadline(null);
  const text = readFileSync(join(BIN, 'guard.mjs'), 'utf8');
  assert.match(text, /DECISION_FROM_START_MS = 8500/);
  assert.match(text, /BELT_MS = 9000/);
});

test('K5-F: role overrides come from the committed flow.json; an uncommitted working-tree flow.json changes nothing', (t) => {
  const root = makeRepo(t, 'tech-lead', { roles: ROLES });
  stage(root, { 'docs/a.md': 'a\n', 'src/app.js': 'x\n' });
  commitAll(root, 'seed');
  const write = { tool: 'Write', filePath: join(root, 'src', 'app.js') };
  assert.equal(decideAs(root, 'tech-lead', write).allow, false, 'tech-lead writes docs only');
  // the same person writes a flow.json that gives tech-lead the whole tree, and does not commit it
  const flow = JSON.stringify({ version: 1, roles: { 'tech-lead': { write_globs: ['**'] } } });
  mkdirSync(join(root, '.bootstrap'), { recursive: true });
  writeFileSync(join(root, '.bootstrap', 'flow.json'), flow);
  assert.equal(decideAs(root, 'tech-lead', write).allow, false, 'an uncommitted flow.json is not believed');
  // committed (as the Chief of Staff's reviewed flow change would be), it is
  sh(root, 'add', '-f', '.bootstrap/flow.json');
  commitAll(root, 'flow change');
  assert.equal(decideAs(root, 'tech-lead', write).allow, true, 'the committed flow is believed');
  // and a later working-tree edit that narrows or widens it is again not believed
  writeFileSync(join(root, '.bootstrap', 'flow.json'), JSON.stringify({ version: 1, roles: { 'tech-lead': { write_globs: ['docs/**'] } } }));
  assert.equal(decideAs(root, 'tech-lead', write).allow, true, 'the committed copy still decides');
  assert.equal(typeof guard.committedFlow, 'function');
});

test('K5-C: the company layer by path must be a file inside the project, read from the committed copy; absolute and ".." paths are refused and reported', (t) => {
  const root = makeRepo(t, 'tech-lead', { roles: ROLES });
  const outside = mkdtempSync(join(tmpdir(), 'bunny-company-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'company.json'), JSON.stringify({ version: 1, name: 'Outside', defaults: { preset: 'full' } }));
  mkdirSync(join(root, 'company'), { recursive: true });
  writeFileSync(join(root, 'company', 'company.json'), JSON.stringify({ version: 1, name: 'Inside Co' }));
  const layersFor = (ext, ref = null) => {
    mkdirSync(join(root, '.bootstrap'), { recursive: true });
    writeFileSync(join(root, '.bootstrap', 'flow.json'), JSON.stringify({ version: 1, extends: ext }));
    return flowLib.loadLayers(root, { ref });
  };
  for (const bad of [join(outside, 'company.json'), fwd(join(outside, 'company.json')), '../company.json', 'company/../../x.json', '..\\company.json', '\\\\server\\share\\c.json', 'C:/x/company.json']) {
    const layers = layersFor(bad);
    assert.equal(layers.company, null, `refused: ${bad}`);
    assert.equal(layers.refusedCompany, bad);
    const flow = flowLib.merge(layers);
    assert.ok(flowLib.validate(layers, flow).some((f) => f.level === 'error' && /outside this project/.test(f.msg)), `reported: ${bad}`);
  }
  assert.equal(layersFor('company/company.json').company?.name, 'Inside Co', 'a path inside the project is read');
  // with a ref the committed copy is read, not the working tree
  layersFor('company/company.json');
  sh(root, 'add', '-A');
  sh(root, '-c', 'user.email=a@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', 'company');
  writeFileSync(join(root, 'company', 'company.json'), JSON.stringify({ version: 1, name: 'Edited, not committed' }));
  assert.equal(flowLib.loadLayers(root, { ref: 'HEAD' }).company.name, 'Inside Co');
});

test('K5-E: the flow editor puts only the three known role states and a whole number 0 to 5 into the page', () => {
  const html = readFileSync(join(NEXT, '.bootstrap', 'ui', 'flow-editor.html'), 'utf8');
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const grab = (name) => new RegExp(`const ${name} = [^\\n]*(?:\\n(?!const )[^\\n]*)*?;\\n`).exec(script)?.[0];
  assert.ok(grab('STATES') && grab('famOf') && grab('helperMax'), 'the editor has STATES, famOf and helperMax');
  const make = new Function('F', `${grab('STATES')}${grab('famOf')}${grab('helperMax')}return { famOf, helperMax };`);
  const evil = make(() => ({ family: { qa: '"><img src=x onerror=alert(1)>', ops: 'on', docs: 'off' }, helpers: {} }));
  assert.equal(evil.famOf('qa'), 'optional', 'an unknown state never reaches the page');
  assert.equal(evil.famOf('ops'), 'on');
  assert.equal(evil.famOf('docs'), 'off');
  assert.equal(evil.famOf('chief-of-staff'), 'on');
  for (const [value, want] of [[2, 2], ['<script>', 0], ['7', 5], [-3, 0], [1.9, 1], [undefined, 0], ['"><b>', 0]]) assert.equal(evil.helperMax({ max_per_session: value }), want, String(value));
  // the places that print the state go through esc()
  assert.ok(!/class="edge \$\{p\.st\}"/.test(html) && !/class="n \$\{p\.st\}"/.test(html) && !/is-\$\{st\}"/.test(html) && !/<b>\$\{h\.max_per_session\}<\/b>/.test(html));
});

test('K5-D: the staged kit\'s policy.json can be edited like the rest of the staged kit; every real policy.json and git file stays Chief-only', () => {
  const planted = policyLib.plantedGitPath;
  assert.equal(planted('scripts/kit-next/.bootstrap/policy.json'), false);
  assert.equal(planted('./scripts/kit-next/.bootstrap/policy.json'), false);
  assert.equal(planted('.bootstrap/policy.json'), true);
  assert.equal(planted('vendor/evil/.bootstrap/policy.json'), true);
  assert.equal(planted('scripts/kit-next/.bootstrap/policy.json.bak'), false);
  assert.equal(planted('x/scripts/kit-next/.bootstrap/policy.json'), true, 'only the exact staged path');
  assert.equal(planted('.git/config'), true);
  assert.equal(planted('a/commondir'), true);
});

test('G1-3, G1-4, G1-5 (Security): hook switch-offs, aliases, a git directory pointed elsewhere, a push target built from a variable and a role set through a variable are refused for a builder (put back by K-1; this is their regression table)', (t) => {
  const root = seeded(t);
  const refused = [
    'rm -rf .githooks', 'mv .githooks x', 'git config alias.ci "commit -n"', 'git config core.fsmonitor calc', 'git config core.sshCommand evil',
    'git --git-dir=/tmp/x commit -m y', 'GIT_DIR=/tmp/x git commit -m y', 'git commit-tree HEAD^{tree} -m z', 'git update-ref refs/heads/foo HEAD',
    'git push origin $(echo main)', 'M=main; git push origin $M', 'git push origin HEAD:${B:-main}',
    'R=BOOTSTRAP_ROLE; env $R=chief-of-staff git commit -m x', 'BOOTSTRAP_ROLE=chief-of-staff git commit -m x',
  ];
  for (const c of refused) assert.equal(bash(root, 'builder', c).allow, false, c);
  assert.equal(lib != null && NEXT.endsWith('kit-next'), true, 'run against the staged kit');
});

test('K5-W (Chief of Staff, Librarian\'s board check): a shell command that writes a file is judged by the role\'s write_globs, like the file tools: a role that writes docs only cannot write src with echo, Set-Content, tee, cp, mv, sed -i, a heredoc or a redirect', (t) => {
  const root = seeded(t, 'tech-lead');
  const refused = [
    'echo x > src/app.js', 'echo x >> src/app.js', 'Set-Content src/app.js x', 'Add-Content src/app.js x', 'Out-File src/app.js', 'echo x | tee src/app.js', 'cp a.txt src/app.js', 'Copy-Item a.txt src/app.js',
    'mv a.txt src/app.js', 'sed -i s/a/b/ src/app.js', 'cat > src/app.js <<EOF\nx\nEOF', 'touch src/app.js', 'rm src/app.js', 'echo x > "src/app.js"', "echo x > 'src/new file.js'", 'echo x > ./src/../src/app.js',
    'mkdir src/new', 'echo x > .\\src\\app.js', 'New-Item src/app.js', 'Remove-Item src/app.js',
  ];
  const allowed = ['echo x > docs/note.md', 'cat a.txt', 'echo x > README.md', 'Set-Content docs/plans/x.md y', 'cp docs/a.md docs/b.md', 'echo x > /dev/null', 'git status > NUL', 'echo x 2>&1', 'ls src'];
  for (const c of refused) assert.equal(bash(root, 'tech-lead', c).allow, false, `refused: ${c}`);
  for (const c of allowed) assert.equal(bash(root, 'tech-lead', c).allow, true, `allowed: ${c}`);
  // a role with no write limit (builder) is not held back by this
  assert.equal(bash(root, 'builder', 'echo x > src/app.js').allow, true);
});

test('K5-X (Chief of Staff, the Librarian board check): a path on another drive or share is outside the repository, never inside it, in the file tools and in shell commands', (t) => {
  const root = seeded(t, 'tech-lead');
  const rel = (file) => policyLib.toRepoPath(root, file, root);
  assert.equal(rel(join(root, 'src', 'a.js')), 'src/a.js');
  if (process.platform === 'win32') {
    const BS = String.fromCharCode(92);
    const drive = root[0].toUpperCase();
    const other = drive === 'Z' ? 'Y' : 'Z';
    const tail = root.slice(3);
    const winTail = tail.split(BS).join(BS);
    const cases = [`${other}:${BS}${winTail}${BS}src${BS}a.js`, `${other}:/${fwd(tail)}/src/a.js`, `${BS}${BS}server${BS}share${BS}${winTail}${BS}src${BS}a.js`, `${BS}${BS}?${BS}${other}:${BS}x${BS}src${BS}a.js`];
    for (const f of cases) {
      const r = rel(f);
      assert.ok(r === null || (typeof r === 'object' && r.refused), `outside, not "src/a.js": ${f} -> ${JSON.stringify(r)}`);
    }
    // a docs-only role: a write to another drive is not "src/a.js" of this repository, and the same drive spelled with forward slashes still is
    // another drive (here one that does not exist, so it cannot be resolved) is never read as this repository's src/a.js: either it is outside (allowed) or it is refused as unreadable, never as a scope hit on src/a.js
    const away = bash(root, 'tech-lead', `echo x > ${other}:/${fwd(tail)}/src/a.js`);
    assert.ok(away.allow === true || /could not be read safely/.test(away.reason), `another drive is not this repository: ${JSON.stringify(away)}`);
    assert.doesNotMatch(String(away.reason ?? ''), /writes only docs/, 'not judged as a path inside the repository');
    assert.equal(bash(root, 'tech-lead', `echo x > ${root[0]}:/${fwd(tail)}/src/a.js`).allow, false, 'the own drive of the repository, spelled with forward slashes, is this repository');
    const tool = guard.decide({ tool: 'Write', filePath: cases[0], cwd: root });
    assert.ok(tool.allow === true || /could not be read safely/.test(tool.reason), `the file tool agrees: ${JSON.stringify(tool)}`);
    assert.equal(guard.decide({ tool: 'Write', filePath: join(root, 'src', 'a.js'), cwd: root }).allow, false);
  }
});
