// K-1 4a0fa01 (Security): can the "a worktree of the same repository keeps its own role and policy" rule be used to escape the project's policy?
if (process.env.KIT_NEXT === undefined) process.env.KIT_NEXT = '1';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const P = h.makeRepo({ after() {} }, 'chief-of-staff');   // the project (main checkout), role chief-of-staff
h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed'); const MAIN = sh0(P);
function sh0(P) { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: P, encoding: 'utf8' }).trim(); }
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const gitdir = (d) => sh(d, 'rev-parse', '--absolute-git-dir');
const fwd = (p) => p.split(String.fromCharCode(92)).join('/');
// the legitimate case: a session worktree inside the project, role builder in its own role file
sh(P, 'branch', 'claude/b1');
mkdirSync(join(P, '.claude', 'worktrees'), { recursive: true });
sh(P, 'worktree', 'add', '-q', join(P, '.claude', 'worktrees', 'b1'), 'claude/b1');
const W = join(P, '.claude', 'worktrees', 'b1');
writeFileSync(join(gitdir(W), 'bootstrap-role'), 'builder\n');
// an old commit with no policy at all (history before the kit), checked out as a worktree inside the project
sh(P, 'checkout', '-q', '--orphan', 'old'); sh(P, 'rm', '-rf', '-q', '.'); writeFileSync(join(P, 'README.txt'), 'old'); sh(P, 'add', 'README.txt'); sh(P, 'commit', '-q', '-m', 'old history');
sh(P, 'checkout', '-q', '-f', MAIN);
const OLD = join(P, 'vendor', 'old'); mkdirSync(join(P, 'vendor'), { recursive: true });
sh(P, 'worktree', 'add', '-q', OLD, 'old');
// a planted git dir: a folder with a .git file pointing at a gitdir that claims the real common dir
const EVIL = join(P, 'vendor', 'evil'); const EG = join(P, 'vendor', 'evilgit');
mkdirSync(EVIL, { recursive: true }); mkdirSync(join(EG), { recursive: true });
writeFileSync(join(EVIL, '.git'), 'gitdir: ' + fwd(EG) + '\n');
writeFileSync(join(EG, 'HEAD'), 'ref: refs/heads/claude/b1\n');
writeFileSync(join(EG, 'commondir'), fwd(join(P, '.git')) + '\n');
writeFileSync(join(EG, 'gitdir'), fwd(join(EVIL, '.git')) + '\n');
mkdirSync(join(EVIL, '.bootstrap'), { recursive: true });
writeFileSync(join(EVIL, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz', dev: null }, protected_globs: [], deny_all: [], releases: { dir: 'docs/r', live_pushers: ['builder', 'chief-of-staff'] }, scope_check: { commit: false, push: false } }));
writeFileSync(join(EG, 'bootstrap-role'), 'chief-of-staff\n');
const attacks = [['Bash', { command: 'git push origin main' }, 'push main'], ['Bash', { command: 'echo x > AGENTS.md' }, 'redirect into AGENTS.md'], ['Write', { filePath: join(P, 'AGENTS.md') }, 'Write the project AGENTS.md'], ['Write', { filePath: join(P, '.bootstrap', 'policy.json') }, 'Write the project policy']];
const where = { 'session worktree (own role builder)': W, 'old-history worktree (no policy)': OLD, 'planted git dir (own policy, own role)': EVIL };
for (const hookIn of ['project', 'in the cwd']) for (const [label, cwd] of Object.entries(where)) {
  process.chdir(hookIn === 'project' ? P : cwd); process.env.CLAUDE_PROJECT_DIR = P;
  const out = attacks.map(([tool, extra, name]) => { const r = h.guard.decide({ tool, cwd, ...extra }); return (r.allow ? 'ALLOWED' : 'refused') + ' ' + name + (r.allow ? '' : (r.reason.match(/role "([^"]+)"|you are "([^"]+)"/)?.[0] ?? '').replace(/^/, ' (') + (r.reason.match(/role "([^"]+)"|you are "([^"]+)"/)?.[0] ? ')' : '')); });
  console.log(`hook in ${hookIn.padEnd(10)} | ${label}`); out.forEach((o) => console.log('     ' + o));
}
// ---- extra: files of the main checkout seen from a session worktree, and the pre-push hook run from each place
console.log('--- from the session worktree (role builder), files of the MAIN checkout by absolute path');
process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P;
for (const [tool, extra, name] of [
  ['Write', { filePath: join(P, '.githooks', 'pre-commit') }, 'Write main/.githooks/pre-commit'],
  ['Write', { filePath: join(P, '.bootstrap', 'bin', 'guard.mjs') }, 'Write main/.bootstrap/bin/guard.mjs'],
  ['Bash', { command: 'echo x > ' + fwd(join(P, '.githooks', 'pre-commit')) }, 'shell redirect into main/.githooks/pre-commit'],
  ['Bash', { command: 'echo x > ' + fwd(join(P, 'AGENTS.md')) }, 'shell redirect into main/AGENTS.md'],
  ['Bash', { command: 'Set-Content ' + fwd(join(P, '.bootstrap', 'policy.json')) + ' x' }, 'Set-Content main/.bootstrap/policy.json'],
]) { const r = h.guard.decide({ tool, cwd: W, ...extra }); console.log('     ' + (r.allow ? 'ALLOWED' : 'refused') + ' ' + name); }
console.log('--- the pre-push hook (kit-next prepush.mjs) started in each place, pushing main as builder');
import { spawnSync } from 'node:child_process';
const NL = String.fromCharCode(10);
for (const [label, cwd] of Object.entries({ 'session worktree (role file builder)': W, 'old-history worktree (no policy file)': OLD, 'planted git dir': EVIL })) {
  const sha = sh(P, 'rev-parse', 'HEAD');
  const r = spawnSync(process.execPath, [join(h.BIN, 'prepush.mjs')], { cwd, input: 'refs/heads/x ' + sha + ' refs/heads/main ' + '0'.repeat(40) + NL, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '' } });
  console.log('     ' + label.padEnd(42) + 'exit ' + r.status + '  ' + ((r.stderr || '').split(NL)[0] || '').slice(0, 100));
}
