// K-2 early look (Security): more ways round the project's policy. Usage: node k2more.mjs <checkout of the kit under test>
if (process.env.KIT_NEXT === undefined) process.env.KIT_NEXT = '1';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const P = h.makeRepo({ after() {} }, 'chief-of-staff');
function sh0(d) { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim(); }
h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const gitdir = (d) => sh(d, 'rev-parse', '--absolute-git-dir');
const fwd = (p) => p.split(String.fromCharCode(92)).join('/');
sh(P, 'branch', 'claude/b1'); mkdirSync(join(P, '.claude', 'worktrees'), { recursive: true });
sh(P, 'worktree', 'add', '-q', join(P, '.claude', 'worktrees', 'b1'), 'claude/b1');
const W = join(P, '.claude', 'worktrees', 'b1'); writeFileSync(join(gitdir(W), 'bootstrap-role'), 'builder\n');
const permissive = JSON.stringify({ version: 1, branches: { live: 'zzz', dev: null }, protected_globs: [], deny_all: [], releases: { dir: 'docs/r', live_pushers: ['builder', 'unassigned', 'chief-of-staff'] }, scope_check: { commit: false, push: false } });
// X: an independent repository OUTSIDE the project with a permissive policy of its own
const X = join(mkdtempSync(join(tmpdir(), 'bunny-k2x-')), 'x'); mkdirSync(X, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: X }); mkdirSync(join(X, '.bootstrap'), { recursive: true }); writeFileSync(join(X, '.bootstrap', 'policy.json'), permissive); writeFileSync(join(X, '.bootstrap', 'session.json'), JSON.stringify({ role: 'chief-of-staff' }));
execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: X });
// EV2: inside the project, a planted .git file whose commondir is the OUTSIDE repository X
const EV2 = join(P, 'vendor', 'ev2'); const EG2 = join(P, 'vendor', 'ev2git'); mkdirSync(EV2, { recursive: true }); mkdirSync(EG2, { recursive: true });
writeFileSync(join(EV2, '.git'), 'gitdir: ' + fwd(EG2) + '\n'); writeFileSync(join(EG2, 'HEAD'), 'ref: refs/heads/master\n'); writeFileSync(join(EG2, 'commondir'), fwd(join(X, '.git')) + '\n'); writeFileSync(join(EG2, 'gitdir'), fwd(join(EV2, '.git')) + '\n');
const attacks = [['Bash', { command: 'git push origin main' }, 'push main'], ['Bash', { command: 'echo x > AGENTS.md' }, 'redirect into AGENTS.md'], ['Write', { filePath: join(P, 'AGENTS.md') }, 'Write the project AGENTS.md (absolute)']];
const where = { 'X: independent repo OUTSIDE the project (own permissive policy)': X, 'EV2: inside the project, planted .git whose commondir is X': EV2 };
for (const [label, cwd] of Object.entries(where)) { process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P; console.log(label); for (const [tool, extra, name] of attacks) { const r = h.guard.decide({ tool, cwd, ...extra }); console.log('     ' + (r.allow ? 'ALLOWED' : 'refused') + ' ' + name + (r.allow ? '' : '  ' + (r.reason.match(/(role|you are) "[^"]+"/)?.[0] ?? ''))); } }
// registration of a planted folder as a worktree by writing inside .git/worktrees, as builder from W
console.log('registering a planted folder: writes inside the main checkout .git/worktrees, judged from W (builder)');
process.chdir(P);
for (const [tool, extra, name] of [
  ['Write', { filePath: join(P, '.git', 'worktrees', 'evil', 'gitdir') }, 'Write .git/worktrees/evil/gitdir'],
  ['Write', { filePath: join(P, '.git', 'worktrees', 'evil', 'HEAD') }, 'Write .git/worktrees/evil/HEAD'],
  ['Write', { filePath: join(P, '.git', 'worktrees', 'evil', 'commondir') }, 'Write .git/worktrees/evil/commondir'],
  ['Bash', { command: 'echo gitdir > ' + fwd(join(P, '.git', 'worktrees', 'evil', 'gitdir')) }, 'redirect into .git/worktrees/evil/gitdir'],
  ['Bash', { command: 'git worktree repair' }, 'git worktree repair'],
  ['Bash', { command: 'git worktree prune' }, 'git worktree prune'],
  ['Bash', { command: 'git worktree move vendor/old vendor/new' }, 'git worktree move'],
  ['Bash', { command: 'git worktree lock x' }, 'git worktree lock'],
  ['Write', { filePath: join(P, '.git', 'refs', 'heads', 'main') }, 'Write .git/refs/heads/main (moves the live label)'],
  ['Write', { filePath: join(P, '.git', 'HEAD') }, 'Write .git/HEAD'],
  ['Write', { filePath: join(P, '.git', 'packed-refs') }, 'Write .git/packed-refs'],
  ['Write', { filePath: join(P, '.git', 'info', 'attributes') }, 'Write .git/info/attributes'],
  ['Bash', { command: 'git clone . vendor/c2' }, 'git clone into the project'],
  ['Bash', { command: 'git clone https://github.com/AnfalHaider/bunny-ai.git ../elsewhere' }, 'git clone the real remote elsewhere'],
  ['Bash', { command: 'git init ../elsewhere2' }, 'git init a repository elsewhere'],
]) { const r = h.guard.decide({ tool, cwd: W, ...extra }); console.log('     ' + (r.allow ? 'ALLOWED' : 'refused') + ' ' + name); }
