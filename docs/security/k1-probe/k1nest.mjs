// K-1 B7: a nested repository inside the project; the hook runs with cwd inside it.
process.env.KIT_NEXT = '1';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
const sub = join(root, 'vendor', 'sub'); mkdirSync(sub, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: sub });
const deep = join(sub, 'deep'); mkdirSync(deep, { recursive: true });
const cases = [
  ['Bash', { command: 'git push origin main' }, 'inside nested repo'],
  ['Bash', { command: 'git -C ../.. push origin main' }, 'git -C to outer'],
  ['Bash', { command: 'echo x > ../../.bootstrap/policy.json' }, 'redirect into outer policy'],
  ['Bash', { command: 'echo x > ' + join(root, 'AGENTS.md').split(String.fromCharCode(92)).join('/') }, 'redirect to outer AGENTS.md (absolute)'],
  ['Write', { filePath: join(root, '.bootstrap', 'policy.json') }, 'Write outer policy'],
  ['Write', { filePath: join(root, 'AGENTS.md') }, 'Write outer AGENTS.md'],
  ['Write', { filePath: join(sub, 'AGENTS.md') }, 'Write AGENTS.md inside the nested repo (not protected there)'],
];
for (const hookCwd of ['project', 'nested']) { process.chdir(hookCwd === 'project' ? root : sub); console.log('=== the hook process runs in the ' + hookCwd + ' folder'); for (const cwd of [sub]) for (const [tool, extra, label] of cases) {
  const r = h.guard.decide({ tool, cwd, ...extra });
  console.log((r.allow ? 'ALLOWED ' : 'REFUSED ') + (cwd === sub ? '[cwd=sub]  ' : '[cwd=deep] ') + label);
}
}
