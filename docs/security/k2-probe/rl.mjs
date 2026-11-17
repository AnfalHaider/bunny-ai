import { execFileSync } from 'node:child_process';
const h = await import('file:///' + process.env.KCO + '/test/guard-helpers.js');
for (const me of ['unassigned', 'builder', 'qa']) {
  const P = h.makeRepo({ after() {} }, me); h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
  process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P;
  for (const c of ['node .bootstrap/bin/bootstrap.mjs role chief-of-staff', 'node .bootstrap/bin/bootstrap.mjs role release-ops', 'node .bootstrap/bin/bootstrap.mjs role builder', 'node .bootstrap/bin/bootstrap.mjs role unassigned']) {
    const r = h.guard.decide({ tool: 'Bash', command: c, cwd: P }); console.log(me.padEnd(11) + (r.allow ? 'ALLOWED ' : 'refused ') + c.replace('node .bootstrap/bin/bootstrap.mjs ', ''));
  }
}
