/**
 * QA: does the staged guard (scripts/guard-next, board row G-1) get in the way of normal QA work, and does it
 * still stop what it should? Runs the staged guard's decide() as role "qa" in a throwaway repo (never the real one).
 *
 *   node e2e/q2-g1-realworld.mjs        (needs a checkout that has scripts/guard-next and test/guard-helpers.js)
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.cwd();
const { guard, makeRepo } = await import(pathToFileURL(join(root, 'test', 'guard-helpers.js')).href);
const t = { after: () => {} };
const repo = makeRepo(t, 'qa');
const cases = [
  // [label, call, expect allow]
  ['write a doc in docs/', { tool: 'Write', filePath: join(repo, 'docs', 'plans', 'x.md') }, true],
  ['write a test in test/', { tool: 'Write', filePath: join(repo, 'test', 'x.test.js') }, true],
  ['write a spec in e2e/', { tool: 'Write', filePath: join(repo, 'e2e', 'x.spec.js') }, true],
  ['edit a script in e2e/ (.mjs)', { tool: 'Edit', filePath: join(repo, 'e2e', 'q2-x.mjs') }, true],
  ['write my log', { tool: 'Write', filePath: join(repo, 'docs', 'memory', 'logs', 'qa.md') }, true],
  ['write app code (outside scope)', { tool: 'Write', filePath: join(repo, 'src', 'server', 'app.js') }, false],
  ['write the policy', { tool: 'Write', filePath: join(repo, '.bootstrap', 'policy.json') }, false],
  ['git add by path', { tool: 'Bash', command: 'git add docs/plans/audit-q2.md test/q2-audit.test.js' }, true],
  ['git add a sign-off by its exact path', { tool: 'Bash', command: 'git add docs/signoffs/s-1/qa.md' }, true],
  ['git commit', { tool: 'Bash', command: 'git commit -q -m "QA: result"' }, true],
  ['git commit with a multi-line message', { tool: 'Bash', command: 'git commit -q -m "QA: result' + String.fromCharCode(10) + String.fromCharCode(10) + 'more words"' }, true],
  ['git push (own branch, plain)', { tool: 'Bash', command: 'git push' }, true],
  ['git push -u origin claude/qa-5e27b2', { tool: 'Bash', command: 'git push -u origin claude/qa-5e27b2' }, true],
  ['git status / log / diff / fetch', { tool: 'Bash', command: 'git status --short && git log --oneline -3 && git diff --stat && git fetch -q origin' }, true],
  ['git checkout --detach a sha', { tool: 'Bash', command: 'git checkout -q --detach 09b35e4' }, true],
  ['node scripts/gate.mjs', { tool: 'Bash', command: 'node scripts/gate.mjs > "$TEMP/gate.log" 2>&1; echo exit=$?' }, true],
  ['redirect output into the repo root (outside scope)', { tool: 'Bash', command: 'node scripts/gate.mjs > gate.log 2>&1' }, false],
  ['node --test test/', { tool: 'Bash', command: 'node --test test/q2-audit.test.js 2>&1 | grep -E "tests|pass"' }, true],
  ['playwright test', { tool: 'Bash', command: 'npx playwright test e2e/q2-audit.spec.js --reporter=list' }, true],
  ['run my audit scripts', { tool: 'Bash', command: 'BASE=http://127.0.0.1:5392 OUT=/tmp/x node e2e/q2-controls.mjs' }, true],
  ['start an invented-profile server', { tool: 'Bash', command: 'BUNNY_DATA_DIR=/tmp/qa BUNNY_FAKE_UPSTREAM=1 PORT=5392 node src/server/main.js &' }, true],
  ['sign off through the tool', { tool: 'Bash', command: 'node .bootstrap/bin/bootstrap.mjs signoff s-1 --verdict PASS --sha 09b35e4 --note "gate and walk"' }, true],
  ['git push to main', { tool: 'Bash', command: 'git push origin HEAD:main' }, false],
  ['git push --force', { tool: 'Bash', command: 'git push --force origin claude/qa-5e27b2' }, false],
  ['git commit --no-verify', { tool: 'Bash', command: 'git commit --no-verify -m x' }, false],
  ['git commit -n (short skip flag)', { tool: 'Bash', command: 'git commit -n -m x' }, false],
  ['git reset --hard', { tool: 'Bash', command: 'git reset --hard HEAD~1' }, false],
  ['a sign-off for another role', { tool: 'Bash', command: 'node .bootstrap/bin/bootstrap.mjs signoff s-1 --role security --verdict PASS --sha 09b35e4 --note x' }, false],
  // 'npm run release' is not tested here: the guard layer does not read it (scripts/release.mjs refuses a non-release role); running it would risk a publish.
  ['reset the profile', { tool: 'Bash', command: 'BUNNY_RESET_PROFILE=1 node src/server/main.js' }, false],
];
let bad = 0;
for (const [label, call, want] of cases) {
  const r = guard.decide({ ...call, cwd: repo });
  const got = r.allow !== false;
  if (got !== want) bad += 1;
  console.log((got === want ? 'PASS' : 'FAIL').padEnd(5), (want ? 'allowed' : 'blocked').padEnd(8), label, got === want ? '' : `:: got ${got ? 'allowed' : 'blocked'}: ${String(r.reason ?? '').slice(0, 120)}`);
}
console.log(`\n${cases.length - bad} of ${cases.length} as expected`);
process.exit(bad ? 1 : 0);
