const h = await import('file:///' + process.argv[2] + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
for (const c of ['gh gist create README.md', 'gh gist create --public x', 'gh repo create x --public', 'gh repo fork', 'gh variable set X', 'gh run cancel 1', 'gh run rerun 1', 'gh pr review 5 --approve', 'gh pr create --fill', 'gh pr comment 5 -b x', 'gh issue comment 5 -b x', 'gh codespace create', 'gh cache delete x', 'gh label create x', 'gh api user', 'gh api repos/x/y/pulls/5/merge -X PUT', 'gh api repos/x/y/pulls/5/merge --method PUT', 'gh api repos/x/y/dispatches -f event_type=x', 'gh api repos/x/y/actions/workflows/a/dispatches -f ref=main', 'gh api -i repos/x/y', 'gh api repos/x/y -q .name', 'gh api repos/x/y/contents/f -X PUT -f message=x', 'gh api --input - repos/x/y/releases']) {
  const r = h.guard.decide({ tool: 'Bash', command: c, cwd: root });
  console.log(r.allow ? 'ALLOWED' : 'REFUSED', c);
}
