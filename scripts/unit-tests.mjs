// The unit tests, in two steps (agreed with the Chief of Staff, 2026-11-17):
//   1. every test file except the guard and kit files, in parallel, exactly as `node --test test/` ran them;
//   2. the guard and kit files (test/guard-*.test.js, test/kit-next-*.test.js) and the two heavy ones (install-anywhere, confine), one at a time and with CLAUDE_PROJECT_DIR unset.
// Why: those files start the real guard, whose own 6 second deadline refuses commands when the PC is busy with the other test files,
// and with CLAUDE_PROJECT_DIR set to a worktree the guard judges the tests' throwaway repositories by that worktree.
// Nothing is skipped and no assertion or deadline is changed: the same files run, in the same way as before, apart from the order.
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitingFor } from './test-progress.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// BUNNY_TEST_DIR and BUNNY_TEST_SILENT_MS exist for test/test-progress.test.js only: it runs this runner on a folder of its own with a short silence limit.
const testDir = process.env.BUNNY_TEST_DIR ? resolve(process.env.BUNNY_TEST_DIR) : join(root, 'test');

// TEST-DNS: the unit tests never touch the real network (test/support/no-network.mjs), and the gate must not depend on it. A person may try one file with
// BUNNY_TEST_NETWORK=1; this runner, which is the gate's, refuses to start with it set.
if (process.env.BUNNY_TEST_NETWORK === '1') {
  console.error('BUNNY_TEST_NETWORK=1 turns the no-network guard off, for one file a person runs on purpose. The unit-test runner and the gate never run with it: unset it and run again.');
  process.exit(2);
}
const preload = join(root, 'test', 'support', 'no-network.mjs');

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

const all = files(testDir).map((f) => (f.startsWith(root) ? relative(root, f).replace(/\\/g, '/') : f));
const isGuardFile = (f) => /^test\/(guard-[^/]*|kit-next-[^/]*|install-anywhere|confine|confine-run)\.test\.js$/.test(f); // (install-anywhere builds a 5,000-file archive and the confine files compile and run a Windows helper: both ran out of time next to the whole parallel group)
const guard = all.filter(isGuardFile);
const others = all.filter((f) => !isGuardFile(f));

// `node scripts/unit-tests.mjs --list` only prints how the files are split; it runs nothing.
if (process.argv.includes('--list')) {
  console.log(`${others.length} parallel files, ${guard.length} guard and kit files (one at a time)`);
  process.exit(0);
}

// A step that prints nothing for SILENT_MS is stopped and named, so a hang is a failure that says where it stopped, not silence.
const SILENT_MS = Number(process.env.BUNNY_TEST_SILENT_MS) || 4 * 60_000;
function run(label, args, env) {
  const fileArgs = args.filter((a) => /\.test\.js$/.test(a));
  console.log(`\n# ${label}: ${fileArgs.length} files`);
  // TEST-DNS: every test process (and a node a test starts) loads the no-network preload first; a second reporter notes which test started and ended, for the HUNG report
  const progressFile = join(tmpdir(), `bunny-test-progress-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  const nodeOptions = `${env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`.trim();
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [
      '--test', '--test-timeout=120000', '--import', pathToFileURL(preload).href,
      '--test-reporter=spec', '--test-reporter-destination=stdout',
      `--test-reporter=${pathToFileURL(join(root, 'scripts', 'test-progress.mjs')).href}`, `--test-reporter-destination=${progressFile}`,
      ...args,
    ], { cwd: root, env: { ...env, NODE_OPTIONS: nodeOptions }, stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // the run reports files in the order given and only when a file has ended: the first file it has not heard of is the one everything waits for
        let still = '';
        try {
          const { heard, waiting } = waitingFor(readFileSync(progressFile, 'utf8'), fileArgs.map((f) => resolve(root, f)));
          still = `  Waiting for (the run reports files in order, so this one holds the rest back): ${waiting[0] ? relative(root, waiting[0]).replace(/\\/g, '/') : '(none: every file has reported)'}\n  Files finished and reported: ${heard} of ${fileArgs.length}\n`;
          if (waiting.length > 1) still += `  Not yet reported after it: ${waiting.slice(1, 6).map((f) => relative(root, f).replace(/\\/g, '/')).join(', ')}${waiting.length > 6 ? ', ...' : ''}\n`;
        } catch { still = '  (no progress file to read)\n'; }
        console.error(`\nHUNG: "${label}" printed nothing for ${SILENT_MS / 60_000} minutes.\n${still}  The last thing it printed:\n${last.slice(-600)}`);
        child.kill('SIGKILL');
      }, SILENT_MS);
    };
    const pass = (stream, out) => stream.on('data', (chunk) => { out.write(chunk); last = (last + chunk.toString()).slice(-2000); arm(); });
    pass(child.stdout, process.stdout);
    pass(child.stderr, process.stderr);
    arm();
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try { rmSync(progressFile, { force: true }); } catch { /* a temp file */ }
      if (code !== 0) console.error(`\nEXIT: "${label}" ended with code ${code ?? 'none'}, signal ${signal ?? 'none'}`);
      resolveRun(signal ? 1 : code ?? 1);
    });
  });
}

const first = await run('all other unit tests, in parallel', others, process.env);
const { CLAUDE_PROJECT_DIR, ...withoutProjectDir } = process.env;
const second = guard.length ? await run('guard and kit tests, one at a time', ['--test-concurrency=1', ...guard], withoutProjectDir) : 0; // (no guard files: only in test/test-progress.test.js's own folder, where node --test with no file would run everything)
process.exit(first || second ? 1 : 0);
