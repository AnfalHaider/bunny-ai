// W5-1 probe (Security): gh auth status token printing, by role. Usage: GUARD_STAGED=1 node ghs.mjs <checkout of 74fe7ba>
const h = await import('file:///' + process.argv[2] + '/test/guard-helpers.js');
const t = { after() {} };
const list = ['gh auth status --show-token', 'gh auth status -t', 'gh auth status --show-token=true', 'gh auth status --show-token=false', 'gh auth status -ht', 'gh auth status -th github.com', 'gh auth status -vt', 'gh auth status --hostname github.com -t', 'gh auth status -h github.com --show-token', 'GH_X=1 gh auth status -t', 'gh.exe auth status -t', '& gh auth status -t', 'gh "auth" status "-t"', 'gh auth status "--show-token"', "gh auth status '--show-token'", 'gh auth status -- -t', 'gh -R x/y auth status -t', 'gh auth status --active -t', 'gh auth status --json hosts -t', 'echo x; gh auth status -t', 'gh auth status | cat -t', 'gh auth status $f', 'gh auth status @args', 'gh auth token', 'gh auth token --hostname github.com', 'gh auth status', 'gh auth status --hostname github.com', 'gh auth status -h github.com', 'gh auth status --active', 'gh auth setup-git', 'gh config get oauth_token', 'gh api user --include', 'git config --get credential.helper', 'git credential fill'];
for (const role of ['builder', 'release-ops', 'chief-of-staff']) {
  const root = h.makeRepo(t, role);
  console.log('--- role ' + role);
  for (const c of list) { const r = h.guard.decide({ tool: 'Bash', command: c, cwd: root }); console.log((r.allow ? 'ALLOWED ' : 'REFUSED ') + c); }
}
