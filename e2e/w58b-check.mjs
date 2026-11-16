/**
 * QA check for W5-8 at 349061d: the release script's checks (git first, then build, then installer/role/record) and the dry run that
 * lists every failing check. Never publishes. Imports the script's own functions and feeds gatherGitState REAL git in throwaway worktrees;
 * also runs the real command line with --dry-run in the tree under test.
 *
 *   SRC=<worktree at the commit under test> node e2e/w58b-check.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = process.env.SRC; const NL = String.fromCharCode(10);
const { checkTarget, checkBuild, checkGhArgs, gatherGitState, releaseProblems } = await import(pathToFileURL(join(SRC, 'scripts/release.mjs')).href);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = (id, name, fn) => { let v = 'PASS', note = ''; try { note = fn() ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; } rows.push({ id, name, v }); console.log(v.padEnd(5), id.padEnd(5), name, '::', String(note).slice(0, 280)); };
const gitIn = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitSrc = gitIn(SRC); gitSrc(['fetch', 'origin', 'main']); const originMain = gitSrc(['rev-parse', 'origin/main']).trim();
const scratch = mkdtempSync(join(tmpdir(), 'bunny-w58b-')); const made = [];
const wt = (name, rev) => { const dir = join(scratch, name); execFileSync('git', ['worktree', 'add', '--detach', dir, rev], { cwd: SRC, stdio: 'ignore' }); made.push(dir); return dir; };
const state = (dir, target = 'HEAD') => gatherGitState({ git: gitIn(dir), target });
try {
  const here = wt('not-main', 'HEAD'); const atMain = wt('at-main', originMain);
  row('T1', 'a commit that is not origin/main: refused, naming both', () => { const v = checkTarget(state(here)); ok(!v.ok && /not origin\/main/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('T2', 'origin/main, clean tree, HEAD is the target: allowed', () => { const v = checkTarget(state(atMain)); ok(v.ok, v.reason); return 'ok'; });
  row('T3', 'origin/main plus an UNTRACKED file: refused (an untracked file would ship)', () => { writeFileSync(join(atMain, 'brand-new-file.txt'), 'x'); const v = checkTarget(state(atMain)); ok(!v.ok && /untracked/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('T4', 'origin/main plus an edited tracked file: refused', () => { const d = wt('edited', originMain); appendFileSync(join(d, 'README.md'), NL + 'edit' + NL); const v = checkTarget(state(d)); ok(!v.ok && /uncommitted/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('T5', 'the target is origin/main but this folder has another commit checked out: refused (dist/ is built from the folder)', () => { const st = state(here, originMain); const v = checkTarget(st); ok(!v.ok && /checked out/.test(v.reason), JSON.stringify(v)); return v.reason; });
  row('T6', 'checkBuild: matching sha ok; missing, other sha and a dirty-build marker refused', () => { const t = originMain; const a = checkBuild({ target: t, builtSha: t + NL }); const b = checkBuild({ target: t, builtSha: '' }); const c = checkBuild({ target: t, builtSha: 'a'.repeat(40) }); const d = checkBuild({ target: t, builtSha: t.slice(0, 12) + '-dirty' }); ok(a.ok && !b.ok && !c.ok && !d.ok, JSON.stringify([a.ok, b.ok, c.ok, d.ok])); return [b.reason, c.reason, d.reason].map((x) => x.slice(0, 60)).join(' | '); });
  row('T7', 'checkGhArgs: only --notes-file goes on to gh; --draft, --repo, --latest=false, a bare --notes-file are refused', () => { const good = checkGhArgs(['--notes-file', 'n.md']); const bad = [['--draft'], ['--repo', 'x/y'], ['--latest=false'], ['--prerelease'], ['--notes-file']].map((a) => checkGhArgs(a)); ok(good.ok && good.args.join() === '--notes-file,n.md' && bad.every((b) => !b.ok), JSON.stringify([good, bad.map((b) => b.ok)])); return 'ok'; });
  row('T8', 'releaseProblems collects every failing check, git ones first', () => { const p = releaseProblems({ gitChecks: [{ ok: false, reason: 'A' }, { ok: true }, { ok: false, reason: 'B' }], later: [{ ok: false, reason: 'C' }, { ok: true }] }); ok(p.join() === 'A,B,C', p.join()); return p.join(' | '); });
  row('T9', 'the real command as a non-release session on a non-main commit: --dry-run lists every problem at once, exits 1, and publishes nothing', () => {
    const r = spawnSync(process.execPath, ['scripts/release.mjs', '--dry-run'], { cwd: here, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: undefined } }); const lines = String(r.stderr).split(NL).filter(Boolean);
    ok(r.status === 1, 'exit ' + r.status); ok(lines.length >= 4, 'only ' + lines.length + ' problem lines'); ok(lines.some((l) => /not origin\/main/.test(l)) && lines.some((l) => /build-sha/.test(l)) && lines.some((l) => /Missing .*\.exe/.test(l)), lines.join(' | ').slice(0, 200)); ok(!/Published|Dry run: would publish/.test(r.stdout + r.stderr), 'it went further'); ok(/Note: Only Release Ops or Hotfix/.test(r.stdout), 'no role note'); return `${lines.length} problems listed: ` + lines.map((l) => l.slice(0, 40)).join(' | ');
  });
  row('T10', 'OBSERVATION: with a non-main commit AND an untracked file the dry run lists the not-main problem but not the untracked one (the git checks stop at the first failing git rule; the untracked one shows once the branch is main)', () => {
    writeFileSync(join(here, 'brand-new-untracked.txt'), 'x'); const r = spawnSync(process.execPath, ['scripts/release.mjs', '--dry-run'], { cwd: here, encoding: 'utf8' }); const mentionsUntracked = /untracked/.test(r.stderr); return `untracked mentioned: ${mentionsUntracked} (recorded, not graded)`;
  });
} finally {
  for (const dir of made) { try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: SRC, stdio: 'ignore' }); } catch { /* gone */ } }
  try { execFileSync('git', ['worktree', 'prune'], { cwd: SRC, stdio: 'ignore' }); } catch { /* x */ }
}
console.log(NL + `${rows.filter((r) => r.v === 'PASS').length} PASS / ${rows.filter((r) => r.v === 'FAIL').length} FAIL of ${rows.length}`);
