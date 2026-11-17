// The gate: the one command that proves a change is safe to push (AGENTS.md O2).
// Runs every check in order, keeps going after a failure so the report is complete,
// and exits non-zero if any check failed. Paste its output into the report.
//
//   node scripts/gate.mjs            everything
//   node scripts/gate.mjs --quick    skip the end-to-end suite (local iteration only, never for a push)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const results = [];
function step(name, cmd, args, { tail = 6, ok = (r) => r.status === 0, failures = false } = {}) {
  const t0 = Date.now();
  // Only npm/npx (.cmd files on Windows) need a shell; a shell would mangle git patterns and paths with spaces.
  const shell = process.platform === 'win32' && /\.cmd$/.test(cmd);
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell, maxBuffer: 64 << 20 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/);
  const pass = ok(r, out);
  results.push({ name, pass, secs: Math.round((Date.now() - t0) / 1000) });
  console.log(`\n== ${pass ? 'PASS' : 'FAIL'}  ${name}  (${Math.round((Date.now() - t0) / 1000)}s)`);
  console.log(out.slice(-tail).map((l) => `   ${l}`).join('\n'));
  // GATE-NAMES: a failed test run names what failed (the last few lines hid it three times): every failing-test line, each failure's assertion line, and the totals.
  if (failures && !pass) {
    const marks = out.filter((l) => /^\s*(✖|not ok)\b|^ℹ (tests|suites|pass|fail|cancelled|skipped|todo)\b|AssertionError|\bError \[ERR_|^\s*(TypeError|ReferenceError|RangeError|Error):/.test(l));
    console.log(`   -- what failed (${marks.length} marked lines${marks.length > 120 ? ', the first 120' : ''}) --`);
    console.log(marks.slice(0, 120).map((l) => `   ${l.slice(0, 300)}`).join('\n'));
  }
}

// A secret in the repository is a leak with a permanent history: tracked files only, values never printed.
function secretScan() {
  const t0 = Date.now();
  const files = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean)
    .filter((f) => !/^(node_modules|dist|dist-next|test-results)\//.test(f) && !/\.(png|jpe?g|webp|ico|exe|blockmap|woff2?)$/i.test(f));
  const pattern = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|xox[bp]-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
  // Invented values used by the tests are allowed; they say so in the value itself.
  const invented = /(test|fake|example|dummy|super|should|roundtrip|integrity|0000|1234|4321|4242|9999|xxxx|abcdef)/i;
  const hits = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      const m = pattern.exec(line);
      if (m && !invented.test(m[0])) hits.push(`${f}:${i + 1} (${m[0].slice(0, 4)}…)`);
    });
  }
  const pass = hits.length === 0;
  results.push({ name: 'secret scan', pass, secs: Math.round((Date.now() - t0) / 1000) });
  console.log(`\n== ${pass ? 'PASS' : 'FAIL'}  secret scan  (${files.length} tracked files)`);
  if (!pass) console.log(hits.map((h) => `   ${h}`).join('\n'));
}

// G1-6: the family's limits are enforced by git hooks; a checkout where they are missing or pointed elsewhere is not guarded.
function hooksWired() {
  const t0 = Date.now();
  const problems = [];
  if (existsSync(join(root, '.bootstrap', 'policy.json'))) {
    // ".githooks" here, or an absolute path to a ".githooks" folder (worktrees share the main checkout's setting)
    const hp = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const dir = hp ? resolve(root, hp) : null;
    // it must be THIS checkout's .githooks, or the main checkout's (worktrees share one setting): compared by real path
    const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const real = (x) => { try { return realpathSync(x); } catch { return null; } };
    const allowed = [real(join(root, '.githooks')), common ? real(join(dirname(common), '.githooks')) : null].filter(Boolean);
    if (!dir || !real(dir) || !allowed.includes(real(dir))) problems.push(`core.hooksPath is "${hp || 'unset'}", not this checkout's or the main checkout's .githooks folder`);
    else for (const h of ['pre-commit', 'pre-push']) if (!existsSync(join(dir, h))) problems.push(`${join(dir, h)} is missing`);
  }
  const pass = problems.length === 0;
  results.push({ name: 'git hooks wired', pass, secs: Math.round((Date.now() - t0) / 1000) });
  console.log(`\n== ${pass ? 'PASS' : 'FAIL'}  git hooks wired`);
  if (!pass) console.log(problems.map((p) => `   ${p}`).join('\n'));
}

console.log(`gate @ ${spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()}${quick ? ' (quick: no end-to-end, not valid for a push)' : ''}`);
step('conflict markers', 'git', ['grep', '-nE', '^(<<<<<<<|>>>>>>>)( |$)', '--', '.', ':!node_modules'], { ok: (r) => r.status === 1, tail: 10 });
// S-1: the request guard has one off switch, for tests. It must never be set in code that ships.
step('request guard stays on', 'git', ['grep', '-nE', 'localGuard\\s*:\\s*false', '--', 'src', 'electron', 'scripts', 'e2e'], { ok: (r) => r.status === 1, tail: 4 });
step('unit tests', npm, ['test', '--silent'], { tail: 8, failures: true });
if (!quick) step('end-to-end tests', npx, ['playwright', 'test', '--reporter=line'], { tail: 8 });
step('memory check', process.execPath, ['.bootstrap/bin/mem.mjs', 'check'], { tail: 4 });
step('dependency audit (high+)', npm, ['audit', '--audit-level=high'], { tail: 6 });
secretScan();
hooksWired();

const failed = results.filter((r) => !r.pass);
console.log(`\nGATE ${failed.length ? 'FAILED' : 'PASSED'}: ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — failed: ${failed.map((f) => f.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
