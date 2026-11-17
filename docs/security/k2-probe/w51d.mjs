import { execFileSync } from 'node:child_process';
const CO = process.env.KCO;
process.env.KIT_NEXT = '1';
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const P = h.makeRepo({ after() {} }, 'builder'); h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P;
const KEY = 'BOOTSTRAP' + '_' + 'ROLE';
for (const role of ['builder', 'chief-of-staff', 'release-ops']) {
  process.env[KEY] = role;
  for (const c of ['gh auth token', 'gh auth status --show-token', 'gh auth status -t', 'git credential fill', 'git credential-manager get', 'cmdkey /list', 'git config --get credential.helper', 'git push origin refs/notes/x', 'git push origin HEAD:refs/for/main', 'git push origin HEAD:refs/releases/x', 'git push origin HEAD:refs/heads/live2', 'git push origin +HEAD:refs/heads/main', 'git push origin :main']) {
    const r = h.guard.decide({ tool: 'Bash', command: c, cwd: P }); console.log(role.padEnd(15) + (r.allow ? 'ALLOWED ' : 'refused ') + c);
  }
}
