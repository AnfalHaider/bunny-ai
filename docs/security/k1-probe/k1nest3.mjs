// K-1 K1-2 at the final sha: nested repository, with and without CLAUDE_PROJECT_DIR, with and without a policy of its own.
process.env.KIT_NEXT = '1';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
const mk = (name, ownPolicy) => {
  const d = join(root, 'vendor', name); mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: d });
  if (ownPolicy) { mkdirSync(join(d, '.bootstrap'), { recursive: true }); writeFileSync(join(d, '.bootstrap', 'policy.json'), JSON.stringify({ version: 1, branches: { live: 'zzz', dev: null }, protected_globs: [], deny_all: [], releases: { dir: 'docs/r', live_pushers: ['builder'] } })); }
  return d;
};
const plain = mk('plain', false), planted = mk('planted', true);
const attacks = [
  ['Bash', { command: 'git push origin main' }, 'push main'],
  ['Bash', { command: 'echo x > ../../.bootstrap/policy.json' }, 'redirect into outer policy'],
  ['Write', { filePath: join(root, '.bootstrap', 'policy.json') }, 'Write outer policy'],
  ['Write', { filePath: join(root, 'AGENTS.md') }, 'Write outer AGENTS.md'],
];
const savedEnv = process.env.CLAUDE_PROJECT_DIR;
for (const hookIn of ['project', 'nested-plain', 'nested-planted']) for (const env of [false, true]) {
  process.chdir(hookIn === 'project' ? root : hookIn === 'nested-plain' ? plain : planted);
  if (env) process.env.CLAUDE_PROJECT_DIR = root; else delete process.env.CLAUDE_PROJECT_DIR;
  const res = [];
  for (const cwd of [plain, planted]) for (const [tool, extra, label] of attacks) {
    const r = h.guard.decide({ tool, cwd, ...extra });
    res.push((r.allow ? 'ALLOWED' : 'refused') + ' ' + (cwd === plain ? 'plain  ' : 'planted') + ' ' + label);
  }
  const bad = res.filter((x) => x.startsWith('ALLOWED'));
  console.log(`hook cwd=${hookIn.padEnd(14)} CLAUDE_PROJECT_DIR=${env ? 'set  ' : 'unset'}  ->  ${bad.length ? bad.length + ' of ' + res.length + ' ALLOWED' : 'all ' + res.length + ' refused'}`);
  if (bad.length && bad.length < res.length) bad.forEach((x) => console.log('     ' + x));
}
if (savedEnv !== undefined) process.env.CLAUDE_PROJECT_DIR = savedEnv;
