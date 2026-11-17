// The unit tests, in two steps (agreed with the Chief of Staff, 2026-11-17):
//   1. every test file except the guard and kit files, in parallel, exactly as `node --test test/` ran them;
//   2. the guard and kit files (test/guard-*.test.js, test/kit-next-*.test.js), one at a time and with CLAUDE_PROJECT_DIR unset.
// Why: those files start the real guard, whose own 6 second deadline refuses commands when the PC is busy with the other test files,
// and with CLAUDE_PROJECT_DIR set to a worktree the guard judges the tests' throwaway repositories by that worktree.
// Nothing is skipped and no assertion or deadline is changed: the same files run, in the same way as before, apart from the order.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = join(root, 'test');

/** Every .js, .cjs and .mjs file under test/, as `node --test test/` picks them (node_modules left out). */
function files(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...files(path));
    else if (/\.(c|m)?js$/.test(entry.name)) found.push(path);
  }
  return found.sort();
}

const all = files(testDir).map((f) => relative(root, f).replace(/\\/g, '/'));
const isGuardFile = (f) => /^test\/(guard-[^/]*|kit-next-[^/]*)\.test\.js$/.test(f);
const guard = all.filter(isGuardFile);
const others = all.filter((f) => !isGuardFile(f));

function run(label, args, env) {
  console.log(`\n# ${label}: ${args.filter((a) => a.startsWith('test/')).length} files`);
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...args], { cwd: root, stdio: 'inherit', env });
  return r.status ?? 1;
}

const first = run('all other unit tests, in parallel', others, process.env);
const { CLAUDE_PROJECT_DIR, ...withoutProjectDir } = process.env;
const second = run('guard and kit tests, one at a time', ['--test-concurrency=1', ...guard], withoutProjectDir);
process.exit(first || second ? 1 : 0);
