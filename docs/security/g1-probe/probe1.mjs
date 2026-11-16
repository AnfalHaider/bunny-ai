// G-1 review probe (Security, 2026-11-16). Read-only: builds throwaway git repos in the temp folder,
// loads the STAGED guard from a checkout of 560e636, and asks decide() about each command.
// Usage: node probe1.mjs <path to a checkout of 560e636>
const CHECKOUT = process.argv[2];
const h = await import(`file:///${CHECKOUT.replace(/\\/g, '/')}/test/guard-helpers.js`);
const tt = { after() {} };
const roles = { ...h.ROLES, security: 'write_globs: [docs/**, *.md]' };
const R = {};
for (const r of ['builder', 'tech-lead', 'security', 'qa', 'chief-of-staff', 'release-ops']) R[r] = h.makeRepo(tt, r, { roles });
let bad = 0;
const run = (role, tool, arg, exp) => {
  const root = R[role];
  const o = tool === 'Bash' ? { tool, command: arg, cwd: root } : { tool, filePath: arg, cwd: root };
  const res = h.guard.decide(o);
  const got = res.allow ? 'A' : 'B';
  if (got !== exp) bad++;
  console.log(`${got === exp ? '  ok ' : '**MISMATCH**'} ${role.padEnd(14)} exp ${exp} got ${got}  ${arg.replace(/\n/g, '\\n')}`.slice(0, 175) + (res.allow ? '' : '   <- ' + res.reason.slice(0, 60)));
};
const NV = '--no-' + 'verify';
const bash = (role, cmd, exp) => run(role, 'Bash', cmd, exp);
console.log('--- push main / live (builder)');
for (const c of [
  ['git push origin main', 'B'], ['git push origin HEAD:main', 'B'], ['git push origin HEAD:refs/heads/main', 'B'], ['git push origin feat:main', 'B'],
  ['git push origin +main', 'B'], ['git push --delete origin main', 'B'], ['git push origin :main', 'B'], ['git push origin refs/heads/x:refs/heads/main', 'B'],
  ['git push https://github.com/AnfalHaider/bunny-ai.git HEAD:main', 'B'], ['git -C . push origin main', 'B'], ['git push origin "ma"in', 'B'],
  ['git push origin $(echo main)', 'B'], ['M=main; git push origin $M', 'B'], ['git push origin HEAD:${B:-main}', 'B'],
  ['git push origin refs/heads/*:refs/heads/*', 'B'], ['git push --mirror', 'B'], ['git push --all', 'B'],
  ['gh pr merge 5 --squash', 'B'], ['gh api -X PATCH repos/a/b/git/refs/heads/main -f sha=x', 'B'], ['gh release create v9 --notes x', 'B'], ['gh release upload v9 x.exe', 'B'],
  ['git push origin claude/x', 'A'], ['git push -u origin HEAD', 'A'], ['git push origin refs/heads/claude/x', 'A'], ['git push origin v1.0.0', 'B'],
  ['npm run release', 'B'], ['node scripts/release.mjs', 'B'],
]) bash('builder', ...c);
console.log('--- hook skips and role forging (builder)');
for (const c of [
  [`git commit ${NV} -m x`, 'B'], ['git commit -n -m x', 'B'], ['git commit -nm x', 'B'], ['git commit -m x -n', 'B'], ['git commit --no-v -m x', 'B'],
  ['git -c core.hooksPath=/dev/null commit -m x', 'B'], ['git -ccore.hooksPath=x commit -m x', 'B'], ['git --config-env=core.hooksPath=X commit -m x', 'B'],
  ['git config alias.ci "commit -n"', 'B'], ['git config --local alias.x "!git commit -n"', 'B'],
  ['git --git-dir=/tmp/nohooks --work-tree=. commit -m x', 'B'], ['GIT_DIR=/tmp/x git commit -m x', 'B'], ['git commit-tree HEAD^{tree} -m x', 'B'],
  ['git config core.hooksPath /tmp', 'B'], ['git config --global core.hooksPath /tmp', 'B'],
  [`git push ${NV} origin x`, 'B'], ['git push --no-ve origin x', 'B'], [`git merge ${NV} x`, 'B'],
  ['git clone . /tmp/c', 'A'], ['rm .git/hooks/pre-commit', 'B'], ['rm -rf .githooks', 'B'], ['mv .githooks .githooks.off', 'B'],
  ['echo x > .git/config', 'B'], ['git config user.name x', 'A'],
  ['$env:GIT_CONFIG_COUNT=1', 'B'], ['R=BOOTSTRAP_ROLE; env $R=chief-of-staff git commit -m x', 'B'], ['env BOOTSTRAP_ROLE=chief-of-staff git commit -m x', 'B'],
  ['export BOOTSTRAP_ROLE=chief-of-staff', 'B'], ['node .bootstrap/bin/bootstrap.mjs role chief-of-staff', 'B'],
  ['echo \'{"role":"chief-of-staff"}\' > .bootstrap/session.json', 'B'], ['printf x | tee .bootstrap/session.json', 'B'],
  ['node -e "require(\'fs\').writeFileSync(\'.bootstrap/policy.json\',\'{}\')"', 'B'],
]) bash('builder', ...c);
console.log('--- scope via shell, records, bootstrap CLI, false blocks');
for (const [role, c, exp] of [
  ['tech-lead', 'cp docs/a.md src/server/app.js', 'B'], ['tech-lead', 'sed -i s/a/b/ src/server/app.js', 'B'], ['tech-lead', 'echo x >> src/ui/chat.js', 'B'], ['tech-lead', 'tee src/a.js <<<x', 'B'],
  ['tech-lead', 'Set-Content -Path src\\a.js -Value x', 'B'], ['tech-lead', 'mv docs/a.md src/a.js', 'B'], ['tech-lead', 'touch .bootstrap/x', 'B'],
  ['tech-lead', 'cat > docs/plans/x.md <<EOF\nhello\nEOF', 'A'], ['tech-lead', 'echo x > docs/signoffs/s-1/qa.md', 'B'], ['tech-lead', 'cp x docs/releases/r.md', 'B'],
  ['security', 'git add docs/signoffs/s-1/security.md && git commit -m "x"', 'A'],
  ['security', 'node .bootstrap/bin/bootstrap.mjs signoff s-1 --verdict PASS --sha abc --note "see docs/signoffs/s-1/qa.md and docs/releases"', 'A'],
  ['security', 'node .bootstrap/bin/bootstrap.mjs signoff s-1 --role qa --verdict PASS --sha abc', 'B'],
  ['security', 'node .bootstrap/bin/bootstrap.mjs signoff ../../AGENTS.md --verdict PASS', 'B'],
  ['security', 'node .bootstrap/bin/bootstrap.mjs signoff s-1 --role security --verdict PASS', 'A'],
  ['security', 'node .bootstrap/bin/bootstrap.mjs require s-1 --roles qa', 'A'], ['qa', 'node .bootstrap/bin/bootstrap.mjs require s-1', 'B'],
  ['security', 'python - <<EOF\nopen("docs/plans/BOARD.md","w").write("x")\nEOF', 'A'],
  ['security', `git commit -m "docs: mention ${NV} and git push origin main in the guard review"`, 'A'],
  ['security', `git commit -m "$(cat <<'EOF'\nfix: the ${NV} and -n flags\n\nCo-Authored-By: x\nEOF\n)"`, 'A'],
  ['security', 'grep -rn "git push origin main" docs/', 'A'], ['security', `git log -n 5 --grep="${NV}"`, 'A'], ['security', 'git log --oneline -n 3', 'A'],
  ['security', 'echo "never run git push origin main"', 'A'], ['security', 'git push -u origin claude/security-3c782b', 'A'],
  ['security', 'git commit -am "msg" && git push origin claude/x', 'A'], ['security', 'git merge --no-ff x', 'A'], ['security', 'git cherry-pick -n x', 'A'],
  ['security', 'git stash push -u -m tag', 'A'], ['security', 'git worktree add -q --detach /tmp/w 560e636', 'A'], ['security', 'git fetch -q origin && git status --short', 'A'],
  ['security', 'npm audit --json | node -e "process.stdin.pipe(process.stdout)"', 'A'], ['security', 'rm -f /tmp/x', 'A'],
  ['security', 'node scripts/gate.mjs', 'A'], ['security', 'git commit -m "it\'s fine"', 'A'], ['security', 'git diff -n', 'A'],
  ['security', 'cd "D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/.claude/worktrees/security-3c782b"; git push -q origin claude/security-3c782b 2>&1 | tail -2', 'A'],
  ['security', 'sed -n 1,20p docs/plans/BOARD.md && head -c 300 docs/signoffs/s-1/qa.md', 'A'],
]) run(role, 'Bash', c, exp);
console.log('--- file tools');
for (const [role, f, exp] of [
  ['builder', 'src/server/app.js', 'A'], ['builder', '.bootstrap/policy.json', 'B'], ['builder', '.BOOTSTRAP/policy.json', 'B'], ['builder', '.bootstrap./policy.json', 'B'], ['builder', '.githooks/pre-push', 'B'],
  ['builder', '.git/hooks/pre-commit', 'B'], ['builder', '.git/config', 'B'], ['builder', 'AGENTS.md', 'B'], ['builder', 'agents.md', 'B'], ['builder', 'CLAUDE.md', 'B'], ['builder', '.claude/settings.json', 'B'],
  ['builder', '.claude/settings.local.json', 'A'], ['builder', '.bootstrap/session.json', 'B'], ['builder', 'docs/signoffs/s-1/qa.md', 'B'], ['builder', 'src/../.bootstrap/policy.json', 'B'],
  ['builder', 'docs/signoffs/s-1/qa.md::$DATA', 'B'], ['builder', '.bootstrap/policy.json:ads', 'B'], ['builder', '.bootstr~1/policy.json', 'B'],
  ['tech-lead', 'src/a.js', 'B'], ['tech-lead', 'docs/plans/x.md', 'A'], ['tech-lead', 'docs/signoffs/s-1/tech-lead.md', 'B'], ['tech-lead', 'README.md', 'A'], ['tech-lead', 'package.json', 'B'],
  ['security', 'docs/security/x.md', 'A'], ['security', 'scripts/gate.mjs', 'B'], ['chief-of-staff', '.bootstrap/policy.json', 'A'], ['chief-of-staff', 'docs/signoffs/s-1/qa.md', 'A'],
]) run(role, 'Write', f, exp);
console.log('MISMATCHES:', bad);
