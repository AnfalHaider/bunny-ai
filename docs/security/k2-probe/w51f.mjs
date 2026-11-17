import { execFileSync } from 'node:child_process'; import { join } from 'node:path';
const h = await import('file:///' + process.env.KCO + '/test/guard-helpers.js');
const pp = await import('file:///' + process.env.KCO + '/scripts/kit-next/.bootstrap/bin/prepush.mjs');
const pol = await import('file:///' + process.env.KCO + '/scripts/kit-next/.bootstrap/bin/lib/policy.mjs');
const P = h.makeRepo({ after() {} }, 'builder'); h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: P, encoding: 'utf8' }).trim();
const policy = pol.loadPolicy(P); console.log('live', policy.branches.live, 'pushers', policy.releases.live_pushers.join(','));
for (const role of ['builder', 'qa', 'chief-of-staff']) for (const dst of ['refs/heads/f', 'refs/notes/x', 'refs/for/main', 'refs/releases/x', 'refs/tags/v9', 'refs/heads/' + policy.branches.live.toUpperCase().replace(/^./, (c) => c)])
  console.log(role.padEnd(15) + dst.padEnd(20) + JSON.stringify(pp.checkPush({ root: P, policy, role, localSha: sha, remoteRef: dst, remoteSha: '0'.repeat(40) })).slice(0, 110));
