const h = await import('file:///' + process.argv[2] + '/test/guard-helpers.js');
const t = { after() {} };
for (const role of ['builder', 'security', 'qa']) {
  const root = h.makeRepo(t, role, { roles: { ...h.ROLES, security: 'write_globs: [docs/**, *.md]' } });
  h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
  for (const ref of ['refs/heads/main', 'refs/heads/dev', 'refs/tags/v9', 'refs/heads/claude/x']) {
    const e = h.prepush.checkPush({ root, policy: h.lib.loadPolicy(root), role, localSha: h.git(root, 'rev-parse', 'HEAD'), remoteRef: ref, remoteSha: '0'.repeat(40) });
    console.log(role.padEnd(9), ref.padEnd(22), e.length ? 'REFUSED ' + e[0].slice(0, 70) : 'allowed');
  }
}
