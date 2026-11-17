const K = 'file:///' + process.env.KCO + '/.bootstrap/bin/';
const pol = await import(K + 'lib/policy.mjs'); const rec = await import(K + 'lib/records.mjs');
const policy = JSON.parse((await import('node:fs')).readFileSync(process.env.KCO + '/.bootstrap/policy.json', 'utf8'));
const full = { ...pol.DEFAULT_POLICY, ...policy };
const D = 'docs/', paths = [D + 'flow-' + 'changes/x.md', D + 'kit-' + 'changes/x.md', D + 'rele' + 'ases/x.md', D + 'sign' + 'offs/q/qa.md'];
for (const role of ['builder', 'qa', 'security', 'chief-of-staff']) for (const p of paths) {
  const s = pol.scopeViolation(p, full, {}, role); const r = pol.recordViolation ? pol.recordViolation(p, full, role) : 'n/a';
  const rc = rec.recordChecks({ changes: [{ status: 'A', path: p }], role, policy: full, readNew: () => '---\nrole: ' + role + '\nverdict: PASS\nsha: a\ndate: d\n---\n', readOld: () => '' });
  console.log(role.padEnd(15) + p.padEnd(28) + 'scope:' + (s ? 'refused' : 'ok').padEnd(9) + 'record:' + (r ? 'refused' : 'ok').padEnd(9) + 'recordChecks:' + (rc.length ? 'refused' : 'ok'));
}
