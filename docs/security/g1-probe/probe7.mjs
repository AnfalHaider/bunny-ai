// W5-1 review probe 7 (Security): the three cases probe 4 surfaced, in more spellings.
// Usage: GUARD_STAGED=1 node probe7.mjs <checkout of d3ee1cf>
const h = await import('file:///' + process.argv[2].replace(/\\/g, '/') + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
const NV = '--no-' + 'verify';
const hp = 'core.hooks' + 'Path';
for (const c of ['git config --replace-all alias.ci "commit -n"', 'git config set alias.ci "commit ' + NV + '"', `git config set ${hp} x`, `git config --replace-all ${hp} x`,
  'git push --repo=origin main', 'git push --repo origin main', 'git push origin main --repo=x', 'git push --receive-pack=calc origin x', 'git commit -an -m x', 'git commit --no-ver -m x', 'git commit -m x -n', 'git commit --amend -n',
  `git -c ${hp}=/dev/null commit -m x`, `git rebase ${NV} main`, `git merge ${NV} x`, 'git cherry-pick -n x', 'git am -n x']) {
  const r = h.guard.decide({ tool: 'Bash', command: c, cwd: root });
  console.log(r.allow ? 'ALLOWED' : 'REFUSED', c);
}
