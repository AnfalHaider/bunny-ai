// The unit tests, in two steps (agreed with the Chief of Staff, 2026-11-17):
//   1. every test file except the guard and kit files, in parallel, exactly as `node --test test/` ran them;
//   2. the guard and kit files (test/guard-*.test.js, test/kit-next-*.test.js), one at a time and with CLAUDE_PROJECT_DIR unset.
// Why: those files start the real guard, whose own 6 second deadline refuses commands when the PC is busy with the other test files,
// and with CLAUDE_PROJECT_DIR set to a worktree the guard judges the tests' throwaway repositories by that worktree.
// Nothing is skipped and no assertion or deadline is changed: the same files run, in the same way as before, apart from the order.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = join(root, 'test');

/** Every *.test.js file under test/ (node_modules left out). The helpers, fixtures and probes beside them define no tests, and some are servers that never exit. */
function files(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...files(path));
    else if (/\.test\.js$/.test(entry.name)) found.push(path);
  }
  return found.sort();
}

const all = files(testDir).map((f) => relative(root, f).replace(/\\/g, '/'));
const isGuardFile = (f) => /^test\/(guard-[^/]*|kit-next-[^/]*)\.test\.js$/.test(f);
const guard = all.filter(isGuardFile);
const others = all.filter((f) => !isGuardFile(f));

// `node scripts/unit-tests.mjs --list` only prints how the files are split; it runs nothing.
if (process.argv.includes('--list')) {
  console.log(`${others.length} parallel files, ${guard.length} guard and kit files (one at a time)`);
  process.exit(0);
}

// A step that prints nothing for SILENT_MS is stopped and named, so a hang is a failure that says where it stopped, not silence.
const SILENT_MS = 4 * 60_000;
function run(label, args, env) {
  console.log(`\n# ${label}: ${args.filter((a) => a.startsWith('test/')).length} files`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=120000', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    let timer;
    let tail = '';
    const failing = new Set();
    const started = Date.now();
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.error(`\nHUNG: "${label}" printed nothing for ${SILENT_MS / 60_000} minutes. The last thing it printed:\n${last.slice(-600)}`);
        child.kill('SIGKILL');
      }, SILENT_MS);
    };
    const pass = (stream, out) => stream.on('data', (chunk) => {
      out.write(chunk);
      last = (last + chunk.toString()).slice(-2000);
      // the names of failing tests, kept for the summary at the very end (the gate shows only the last lines of this script's output)
      tail += chunk.toString();
      const lines = tail.split(/\r?\n/);
      tail = lines.pop();
      for (const line of lines) if (/^\s*✖ /.test(line)) failing.add(line.trim().slice(0, 160));
      arm();
    });
    pass(child.stdout, process.stdout);
    pass(child.stderr, process.stderr);
    arm();
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ label, code: signal ? 1 : code ?? 1, seconds: Math.round((Date.now() - started) / 1000), failing: [...failing].slice(0, 12) });
    });
  });
}

const first = await run('all other unit tests, in parallel', others, process.env);
const { CLAUDE_PROJECT_DIR, ...withoutProjectDir } = process.env;
const second = await run('guard and kit tests, one at a time', ['--test-concurrency=1', ...guard], withoutProjectDir);
// The last lines the gate keeps: how long each step took, whether it passed, and the names of the tests that failed.
console.log('\n# SUMMARY');
for (const r of [first, second]) {
  console.log(`# ${r.code === 0 ? 'PASS' : 'FAIL'} ${r.label}: ${r.seconds} s, exit ${r.code}`);
  for (const name of r.failing) console.log(`#   ${name}`);
}
process.exit(first.code || second.code ? 1 : 0);
