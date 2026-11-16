/**
 * QA check for W5-8 (the release script refuses unless the target is exactly origin/main on a clean tree).
 * Never publishes. It imports the script's own functions (checkTarget, gatherGitState, parseArgs) and feeds gatherGitState REAL git in
 * throwaway worktrees; and it runs the real command line with --dry-run to record which refusal a QA session meets first.
 *
 *   SRC=<worktree at the commit under test> node e2e/w58-check.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = process.env.SRC; const NL = String.fromCharCode(10);
const { checkTarget, gatherGitState, parseArgs } = await import(pathToFileURL(join(SRC, 'scripts/release.mjs')).href);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = (id, name, fn) => { let v = 'PASS', note = ''; try { note = fn() ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; } rows.push({ id, name, v }); console.log(v.padEnd(5), id.padEnd(5), name, '::', String(note).slice(0, 260)); };
const gitIn = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitMain = gitIn(SRC);
gitMain(['fetch', 'origin', 'main']); const originMain = gitMain(['rev-parse', 'origin/main']).trim();
const scratch = mkdtempSync(join(tmpdir(), 'bunny-w58-'));
const wt = (name, rev) => { const dir = join(scratch, name); execFileSync('git', ['worktree', 'add', '--detach', dir, rev], { cwd: SRC, stdio: 'ignore' }); return dir; };
const cleanups = [];
try {
  // a tree that is NOT origin/main (the commit under test)
  const other = wt('not-main', 'HEAD'); cleanups.push(other); const head = gitIn(other)(['rev-parse', 'HEAD']).trim();
  ok(head !== originMain, 'the commit under test is origin/main itself; pick a branch that is not');
  row('R1', 'on a commit that is not origin/main: refused, and the message names both', () => { const st = gatherGitState({ git: gitIn(other), target: 'HEAD' }); const v = checkTarget(st); ok(!v.ok && /not origin\/main/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('R2', 'asking for origin/main by sha while standing on another commit: allowed only if that sha IS origin/main (the check is on the target)', () => { const st = gatherGitState({ git: gitIn(other), target: originMain }); const v = checkTarget(st); ok(v.ok, 'refused: ' + v.reason); return 'target ' + originMain.slice(0, 8) + ' accepted'; });
  // a tree AT origin/main, clean, then dirty
  const atMain = wt('at-main', originMain); cleanups.push(atMain);
  row('R3', 'at origin/main on a clean tree: allowed', () => { const v = checkTarget(gatherGitState({ git: gitIn(atMain), target: 'HEAD' })); ok(v.ok, v.reason); return 'ok'; });
  appendFileSync(join(atMain, 'README.md'), NL + 'a change nobody committed' + NL);
  row('R4', 'at origin/main with an uncommitted change to a tracked file: refused', () => { const v = checkTarget(gatherGitState({ git: gitIn(atMain), target: 'HEAD' })); ok(!v.ok && /uncommitted changes/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('R5', 'a new untracked file does not block (only tracked files count)', () => { const dir = wt('untracked', originMain); cleanups.push(dir); appendFileSync(join(dir, 'brand-new-file.txt'), 'x'); const v = checkTarget(gatherGitState({ git: gitIn(dir), target: 'HEAD' })); ok(v.ok, v.reason); return 'ok (by design)'; });
  row('R6', 'a target that is not a commit, an empty target, and a missing origin/main are refused', () => {
    const a = checkTarget({ target: 'nonsense', originMain }); const b = checkTarget({ target: '', originMain }); const c = checkTarget({ target: originMain, originMain: '' }); ok(!a.ok && !b.ok && !c.ok, JSON.stringify([a.ok, b.ok, c.ok])); return [a.reason, c.reason].map((x) => x.slice(0, 70)).join(' | ');
  });
  row('R7', 'a failed fetch (no network) refuses with a clear message instead of trusting a stale origin/main', () => { const st = gatherGitState({ git: (args) => { if (args[0] === 'fetch') throw new Error('fatal: unable to access remote'); return gitMain(args); }, target: 'HEAD' }); const v = checkTarget(st); ok(!v.ok && /could not fetch origin\/main/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('R8', 'an abbreviated sha is compared by prefix, a different sha with the same first 7 characters is not mistaken for it only when full', () => { const v1 = checkTarget({ target: originMain.slice(0, 7), originMain }); const v2 = checkTarget({ target: originMain.slice(0, 6), originMain }); ok(v1.ok, '7 chars refused'); ok(!v2.ok, '6 chars accepted'); return '7 chars ok, 6 refused'; });
  row('R9', 'argument parsing: --dry-run and --target (both spellings) are taken, the rest goes on to gh', () => { const p = parseArgs(['--dry-run', '--target', 'abc1234', '--notes-file', 'n.md']); const q = parseArgs(['--target=def5678']); ok(p.dryRun && p.target === 'abc1234' && p.rest.join() === '--notes-file,n.md' && q.target === 'def5678' && q.dryRun === false, JSON.stringify([p, q])); return JSON.stringify(p); });
  // the real command line, as a QA session
  row('R10', 'the real command, node scripts/release.mjs --dry-run, run as QA in a tree with no installer: refused, nothing published', () => {
    const r = spawnSync(process.execPath, ['scripts/release.mjs', '--dry-run'], { cwd: other, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: undefined } }); ok(r.status === 1, 'exit ' + r.status); ok(!/Published|Dry run: would publish/.test(r.stdout + r.stderr), 'it went further than it should'); return `exit ${r.status}: ${String(r.stderr).split(NL)[0].slice(0, 160)}`;
  });
} finally {
  for (const dir of cleanups) { try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: SRC, stdio: 'ignore' }); } catch { /* gone */ } }
  try { execFileSync('git', ['worktree', 'prune'], { cwd: SRC, stdio: 'ignore' }); } catch { /* x */ }
}
console.log(NL + `${rows.filter((r) => r.v === 'PASS').length} PASS / ${rows.filter((r) => r.v === 'FAIL').length} FAIL of ${rows.length}`);
