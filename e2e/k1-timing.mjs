/**
 * QA, K-1: how long the staged kit's guard takes to decide, as the real hook (a node process fed the payload on stdin), for the
 * shapes that were slow, with and without CPU load. Run from a checkout that has test/guard-helpers.js and scripts/kit-next:
 *   KIT_NEXT=1 [LOAD=4] [SHAPES=a,b,c] node <path>/e2e/k1-timing.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.cwd(); const NL = String.fromCharCode(10);
const { makeRepo } = await import(pathToFileURL(join(root, 'test', 'guard-helpers.js')).href);
const repo = makeRepo({ after: () => {} }, 'qa');
const BIN = join(root, 'scripts', 'kit-next', '.bootstrap', 'bin', 'guard.mjs');
const rep = (s, n) => Array(n).fill(s).join('');
const SHAPES = {
  'status x21000 (252 KB)': () => rep('git status; ', 21000),
  'status x2001 (24 KB)': () => rep('git status; ', 2001),
  'status x1999 (24 KB)': () => rep('git status; ', 1999),
  'push x150 then push main': () => rep('git push; ', 150) + 'git push origin main',
  'push x300 then push main': () => rep('git push; ', 300) + 'git push origin main',
  'push x1999 (under both limits)': () => rep('git push; ', 1999),
  '12 KB sign-off note': () => 'node .bootstrap/bin/bootstrap.mjs signoff w4-8 --verdict PASS --sha e061ce6 --note "' + rep('a quick note about the walk. ', 410).slice(0, 12000) + '"',
  'one-line 64 KB+1 comment': () => 'echo ' + rep('x', 65537),
  'everyday: git status': () => 'git status',
  'everyday: node --test then git log': () => 'node --test test/a.test.js 2>&1 | tail -n 5; git log --oneline -3',
};
const want = (process.env.SHAPES ?? '').split(',').filter(Boolean);
const loaders = [];
for (let i = 0; i < +(process.env.LOAD ?? 0); i++) loaders.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
let out = [];
for (const [name, mk] of Object.entries(SHAPES)) {
  if (want.length && !want.some((w) => name.includes(w))) continue;
  const command = mk(); const t0 = Date.now();
  const r = spawnSync(process.execPath, [BIN], { cwd: repo, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }), encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: 'qa' }, timeout: 900000 });
  const ms = Date.now() - t0; const body = (r.stdout + r.stderr).replace(/\s+/g, ' ');
  const verdict = r.status === 2 || /"decision":\s*"(deny|block)"|permissionDecision.{0,10}deny|Blocked/.test(body) ? 'BLOCK' : 'allow';
  const line = `${name.padEnd(36)} ${String(command.length).padStart(7)} chars  ${String(ms).padStart(7)} ms  ${verdict}  exit=${r.status}  ${verdict === 'BLOCK' ? body.slice(0, 90) : ''}`; console.log(line); out.push(line);
}
for (const l of loaders) l.kill();
process.exit(0);
