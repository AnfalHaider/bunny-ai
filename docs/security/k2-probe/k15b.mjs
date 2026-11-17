// K1-5 (Security): one Bash command of N chained git pushes through the real guard.mjs hook; cut-off must block (exit 2), never pass
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
if (process.env.KIT_NEXT === undefined) process.env.KIT_NEXT = '1';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const P = h.makeRepo({ after() {} }, 'builder');
h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
const PART = process.argv[3] || 'git push origin f';
for (const [n, tail] of [[60, "git status"], [200, "git status"]]) {
  const cmd = Array.from({ length: n }, (_, i) => PART + i).concat([tail]).join(' && ');
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(h.BIN, 'guard.mjs')], { cwd: P, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: P }), encoding: 'utf8', timeout: 150000, env: { ...process.env, CLAUDE_PROJECT_DIR: P, KIT_NEXT: '1', BOOTSTRAP_ROLE: 'builder' } });
  console.log(n + ' pushes + [' + tail + ']: exit ' + r.status + ' signal ' + r.signal + ' in ' + (Date.now() - t) + ' ms | ' + ((r.stderr || r.stdout || '').split(String.fromCharCode(10)).slice(0,3).join(" ~ ")).slice(0, 400));
}
