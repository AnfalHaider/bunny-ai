/**
 * QA, K-1: the everyday QA commands that the live guard got wrong during v0.1.5 to v0.1.7 (false blocks I actually met) plus the
 * things it must still stop, run through decide() as role "qa" in a throwaway repo. Run it twice and compare:
 *   KIT_NEXT=1 node e2e/k1-realworld-extra.mjs        the staged kit 0.6.0 with our hardening (scripts/kit-next)
 *   GUARD_STAGED=1 node e2e/k1-realworld-extra.mjs    the guard v0.1.7 ships (scripts/guard-next)
 * Needs a checkout that has test/guard-helpers.js. Exit code 1 if the staged kit disagrees with what is wanted.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.cwd(); const NL = String.fromCharCode(10);
const { guard, makeRepo } = await import(pathToFileURL(join(root, 'test', 'guard-helpers.js')).href);
const repo = makeRepo({ after: () => {} }, 'qa');
const cases = [
  // [label, call, wanted ('allow' | 'block'), note]
  ['sign-off whose --note quotes the text of a forced push', { tool: 'Bash', command: 'node .bootstrap/bin/bootstrap.mjs signoff w2-7-rules --verdict PASS --sha 8e42b6a --note "the guard refused git push --force and git reset --hard text"' }, 'allow', 'false block I met: the words were only inside a quoted note'],
  ['git push then git worktree remove --force chained with &&', { tool: 'Bash', command: 'git push 2>&1 | tail -n 1; git -C qa worktree remove ../qa-x --force' }, 'allow', 'false block I met: the force flag belongs to worktree remove'],
  ['git push alone then a separate remove --force on the next line', { tool: 'Bash', command: 'git push' + NL + 'git worktree remove qa-x --force' }, 'allow', 'same, with a newline'],
  ['cleanup of invented temp folders', { tool: 'Bash', command: 'rm -rf /c/Users/anfal/AppData/Local/Temp/bunny-w6-* 2>/dev/null; echo cleaned' }, 'allow', 'rm of a temp pattern outside the repo'],
  ['junction for node_modules in a scratch worktree', { tool: 'Bash', command: 'cmd //c "mklink /J qa-x\\node_modules qa-5e27b2\\node_modules"' }, 'allow', 'cmd /c with a quoted command'],
  ['remove that junction', { tool: 'Bash', command: 'cmd //c "rmdir qa-x\\node_modules" 2>/dev/null' }, 'allow', 'cmd /c rmdir of a junction'],
  ['process census with PowerShell', { tool: 'Bash', command: 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name"' }, 'allow', 'read only'],
  ['stop my own gate by pid', { tool: 'Bash', command: 'taskkill //PID 24072 //T //F 2>&1 | tail -n 3' }, 'allow', 'taskkill of a process I started'],
  ['git worktree add --detach a sha', { tool: 'Bash', command: 'git -C qa-5e27b2 worktree add --detach ../qa-x 8e42b6a 2>&1 | tail -n 1' }, 'allow', 'scratch worktree'],
  ['new branch from origin/main', { tool: 'Bash', command: 'git checkout -b claude/qa-signoff-x origin/main 2>&1 | tail -n 1' }, 'allow', ''],
  ['git checkout an existing sign-off branch', { tool: 'Bash', command: 'git checkout claude/qa-signoff-w2-7 2>&1 | tail -n 1' }, 'allow', ''],
  ['restore a file from another branch into e2e/ by a literal name', { tool: 'Bash', command: 'git show claude/qa-w6-rehearsal-2:e2e/w6-rehearsal.mjs > e2e/w6-rehearsal.mjs' }, 'allow', 'redirect inside the QA write scope'],
  ['commit with the attribution line the harness asks for', { tool: 'Bash', command: 'git commit -q -m "QA: x' + NL + NL + 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"' }, 'block', 'the owner never credits Claude; the commit-msg hook is what refuses it, the guard may allow'],
  ['write a sign-off file directly with the Write tool', { tool: 'Write', filePath: join(repo, 'docs', 'signoffs', 'w2-7-rules', 'qa.md') }, 'block', 'only bootstrap signoff writes these'],
  ['sign-off with a variable as the piece id', { tool: 'Bash', command: 'for p in w6-2 w6-3; do node .bootstrap/bin/bootstrap.mjs signoff $p --verdict PASS --sha 643c7da --note x; done' }, 'block', 'piece ids must be plain names'],
  ['git push --force with a lease', { tool: 'Bash', command: 'git push --force-with-lease origin claude/qa-x' }, 'block', ''],
  ['git push origin HEAD:main', { tool: 'Bash', command: 'git push origin HEAD:main' }, 'block', ''],
  ['git push with a quoted verb', { tool: 'Bash', command: 'git "push" origin HEAD:main' }, 'block', 'tokenizer, not regex'],
  ['git reset --hard', { tool: 'Bash', command: 'git reset --hard origin/main' }, 'block', ''],
  ['spoof a release role to run the release script', { tool: 'Bash', command: 'BOOTSTRAP_ROLE=release-ops node scripts/release.mjs --dry-run' }, 'block', 'role spoof'],
  ['write app code', { tool: 'Write', filePath: join(repo, 'src', 'server', 'app.js') }, 'block', 'outside QA scope'],
  ['write the kit itself', { tool: 'Write', filePath: join(repo, '.bootstrap', 'bin', 'guard.mjs') }, 'block', ''],
  ['delete a release with gh', { tool: 'Bash', command: 'gh release delete v0.1.7 --yes' }, 'block', ''],
  ['gh auth token', { tool: 'Bash', command: 'gh auth token' }, 'block', 'prints the sign-in token'],
];
let bad = 0;
for (const [label, call, want, note] of cases) {
  const r = guard.decide({ ...call, cwd: repo });
  const got = r.allow !== false ? 'allow' : 'block';
  const okc = got === want; if (!okc) bad += 1;
  console.log((okc ? 'PASS' : 'DIFF').padEnd(5), `wanted ${want}`.padEnd(13), `got ${got}`.padEnd(10), label, okc ? '' : `:: ${String(r.reason ?? '').slice(0, 110)}`, note && !okc ? ` [${note}]` : '');
}
console.log(NL + `${cases.length - bad} of ${cases.length} as wanted`);
process.exit(bad ? 1 : 0);
