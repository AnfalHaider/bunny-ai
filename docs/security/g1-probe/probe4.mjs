// W5-1 review probe 4 (Security, 2026-11-16): gh publishing, git config/alias/dir tricks, push targets, tokenizer evasions,
// role forging, hook removal. Read-only: throwaway git repos in the temp folder, the STAGED guard of a checkout.
// Usage: GUARD_STAGED=1 node probe4.mjs <path to a checkout of d3ee1cf>
const CHECKOUT = process.argv[2].replace(/\\/g, '/');
const h = await import(`file:///${CHECKOUT}/test/guard-helpers.js`);
const tt = { after() {} };
const roles = { ...h.ROLES, security: 'write_globs: [docs/**, *.md]' };
const R = {};
for (const r of ['builder', 'security', 'qa', 'release-ops']) R[r] = h.makeRepo(tt, r, { roles });
let bad = 0;
const NV = '--no-' + 'verify';
const run = (role, cmd, exp) => {
  const res = h.guard.decide({ tool: 'Bash', command: cmd, cwd: R[role] });
  const got = res.allow ? 'A' : 'B';
  if (got !== exp) { bad += 1; console.log(`**MISMATCH** ${role.padEnd(11)} exp ${exp} got ${got}  ${cmd.replace(/\n/g, '\\n').slice(0, 150)}`); }
};
const B = (cmd, role = 'builder') => run(role, cmd, 'B');
const A = (cmd, role = 'builder') => run(role, cmd, 'A');

console.log('--- gh publishing (builder: all must be refused)');
for (const c of [
  'gh release create v9 dist/x.exe', 'gh release upload v9 x.exe', 'gh release edit v9 --draft=false', 'gh release delete v9', 'gh release delete-asset v9 x',
  'gh pr merge 5', 'gh pr merge --auto 5', 'gh -R AnfalHaider/bunny-ai release create v9', 'gh --repo AnfalHaider/bunny-ai pr merge 5',
  'gh api -X DELETE repos/AnfalHaider/bunny-ai/releases/1', 'gh api --method PATCH repos/AnfalHaider/bunny-ai/git/refs/heads/main -f sha=abc',
  'gh api --method=POST repos/AnfalHaider/bunny-ai/releases -f tag_name=v9', 'gh api repos/AnfalHaider/bunny-ai/releases -f tag_name=v9', 'gh api repos/x/y/releases --input body.json',
  'gh api graphql -f query="mutation { mergePullRequest(input:{pullRequestId:\\"x\\"}) { clientMutationId } }"', 'gh api -XPATCH repos/x/y/git/refs/heads/main', 'gh api -X patch repos/x/y',
  'gh workflow run release.yml', 'gh repo edit --visibility public', 'gh repo delete x --yes', 'gh secret set X', 'gh auth token', 'gh alias set rc "release create"', 'gh extension install x/y',
  'gh ruleset', 'gh pr close 4', 'gh issue create -t x',
  // evasions
  'g"h" release create v9', "'gh' release create v9", 'g\\h release create v9', 'env gh release create v9', 'command gh release create v9', 'xargs gh release create v9', 'nice gh release create v9',
  'timeout 5 gh release create v9', 'gh.exe release create v9', '& gh release create v9', 'powershell -NoProfile -Command "gh release create v9"', 'pwsh -c "gh release create v9"',
  'bash -c "gh release create v9"', 'sh -c \'gh release create v9\'', 'cmd /c gh release create v9', 'cmd.exe /d /c "gh release create v9"', 'eval "gh release create v9"', 'echo hi && gh release create v9',
  'true; gh release create v9', 'gh release create v9 | cat', '(gh release create v9)', 'gh release  create   v9', 'GH_TOKEN=x gh release create v9', 'gh --hostname github.com release create v9',
  'gh release c reate', 'gh release\tcreate v9', 'gh release create v9 #', 'echo $(gh release create v9)', 'echo `gh release create v9`', 'npx gh release create v9', 'npm exec -- gh release create v9',
  'gh "release" "create" v9', 'gh re""lease create v9', 'gh $(echo release) create v9', 'G=gh; $G release create v9', 'gh release `create v9',
  'gh api repos/x/y/releases/1 -X DELETE', 'gh api -F draft=false repos/x/y/releases/1', 'gh api repos/x/y/releases/1 --field draft=false', 'gh api --raw-field a=b repos/x/y/releases',
]) B(c);
console.log('--- gh reads (builder: should be allowed)');
for (const c of ['gh release list', 'gh release view v1', 'gh release download v1', 'gh pr view 5', 'gh pr list', 'gh pr checks 5', 'gh run list', 'gh api repos/AnfalHaider/bunny-ai/releases', 'gh auth status', 'gh issue list', 'gh repo view']) A(c);
console.log('--- gh by the live pusher (release-ops): publishing allowed, owner-only still refused');
A('gh release create v9 x.exe', 'release-ops'); A('gh pr merge 5', 'release-ops'); B('gh release delete v9', 'release-ops'); B('gh release edit v9', 'release-ops');

console.log('--- git config, aliases, location');
for (const c of [
  'git config alias.ci "commit -n"', 'git config --local alias.ci "commit ' + NV + '"', 'git config core.hooksPath /dev/null', 'git config core.hookspath x', 'git config --global core.hooksPath x', 'git config --system alias.x y',
  'git config --file other.cfg core.hooksPath x', 'git config -f other.cfg alias.x y', 'git config --add core.hooksPath x', 'git config --unset core.hooksPath', 'git config --unset-all core.hooksPath', 'git config core.fsmonitor "calc"',
  'git config core.sshCommand "calc"', 'git config include.path x', 'git config includeIf.gitdir:/.path x', 'git config credential.helper "!calc"', 'git config url.x.insteadOf y', 'git config remote.origin.url x', 'git config remote.origin.pushurl x',
  'git config push.default matching', 'git config core.editor calc', 'git config sequence.editor calc', 'git config diff.external calc', 'git config filter.x.clean calc', 'git config merge.tool x', 'git config core.pager calc', 'git config gpg.program calc', 'git config user.signingkey x',
  'git config --edit', 'git config -e', 'git config edit', 'git config set alias.x y', 'git config --rename-section alias foo', 'git config --remove-section alias', 'git config --replace-all alias.x y', 'git config --worktree core.hooksPath x',
  'git -c alias.ci=commit -n ci', 'git -c core.hooksPath=x commit -m a', 'git -c core.fsmonitor=calc status', 'git -ccore.hooksPath=x commit -m a', 'git --config-env=core.hooksPath=X commit -m a',
  'git --git-dir=x commit -m a', 'git --git-dir x commit -m a', 'git --work-tree=x commit -m a', 'GIT_DIR=x git commit -m a', 'GIT_CONFIG_COUNT=1 git commit -m a', 'GIT_CONFIG_GLOBAL=x git commit -m a', 'GIT_CONFIG_SYSTEM=x git status',
  'GIT_EDITOR=calc git commit', 'GIT_SSH_COMMAND=calc git fetch', 'GIT_EXTERNAL_DIFF=calc git diff', 'GIT_PAGER=calc git log', 'GIT_ASKPASS=calc git fetch', 'env GIT_DIR=x git commit -m a', 'export GIT_DIR=x', '$env:GIT_DIR="x"; git commit -m a',
  'git commit-tree HEAD^{tree} -m x', 'git update-ref refs/heads/main HEAD', 'git update-ref refs/heads/x HEAD', 'git update-ref -d refs/heads/x', 'git symbolic-ref HEAD refs/heads/main', 'git fast-import', 'git filter-branch -f --all', 'git replace a b',
  'git hook run pre-commit', 'git remote set-url origin x', 'git remote add evil x', 'git submodule add x y', 'git worktree add ../w', 'git clone --template=x y z', 'git init --template=x', 'git rebase --exec calc HEAD~1', 'git rebase -x calc HEAD~1',
  'git bisect run calc', 'git difftool -x calc', 'git mergetool', 'git instaweb', 'git daemon', 'git svn x', 'git archimport', 'git credential approve', 'git maintenance register', 'git maintenance run',
  'git ci', 'git foo', 'git config --unset alias.ci', 'git push origin $(echo main)', 'M=main; git push origin $M', 'git push origin HEAD:${B:-main}', 'git push origin "$B"', 'git push $R main', 'git push origin HEAD:refs/for/main',
  'git push origin HEAD:refs/heads/ma' + 'in', 'git push origin +HEAD:ma' + 'in', 'git push origin main:main', 'git push --force-with-lease origin main', 'git push -f origin main', 'git push origin --force main', 'git push --repo=origin main',
  'git push origin :refs/heads/main', 'git push origin --delete main', 'git push origin HEAD:refs/tags/v9',
]) B(c);
console.log('--- git normal use (builder: should be allowed)');
for (const c of ['git status', 'git diff', 'git log --oneline -5', 'git add docs/x.md', 'git commit -m "docs: x"', 'git switch -c claude/x', 'git push -u origin claude/x', 'git push origin HEAD', 'git fetch origin', 'git merge origin/main', 'git config --get user.name', 'git config --list', 'git config user.email', 'git branch -a', 'git stash list', 'git show HEAD', 'git rev-parse HEAD', 'git checkout -b claude/y', 'git restore README.md', 'git remote -v', 'git log --grep="' + NV + '"', 'git commit -m "mentions ' + NV + ' in text"']) A(c);

console.log('--- hooks and protected folders removed or hidden');
for (const c of ['rm -rf .githooks', 'rm -r .bootstrap', 'rm -rf .git/hooks', 'mv .githooks .githooks-off', 'Remove-Item -Recurse -Force .githooks', 'Move-Item .githooks x', 'del /s /q .githooks', 'rmdir /s /q .githooks', 'rm .githooks/pre-commit', 'cp x .githooks/pre-commit', 'echo x > .githooks/pre-push',
  'rm -rf .', 'rm -rf *', 'rm -rf .g*', 'rm -rf .[a-z]*', 'mv . ../x', 'cd .. && rm -rf bunny', 'rm -rf "$PWD"', 'find . -name .githooks -exec rm -rf {} +', 'git clean -fdx', 'git clean -fdxq', 'git rm -r .githooks', 'git rm -r --cached .githooks', 'git mv .githooks x', 'ln -s x .githooks', 'New-Item -ItemType Junction -Path .githooks -Target x',
  'robocopy empty .githooks /MIR', 'xcopy /e x .githooks', 'chmod -x .githooks/pre-commit', 'attrib +h .githooks', 'icacls .githooks /deny *S-1-1-0:(W)', 'sed -i s/x/y/ .githooks/pre-commit', 'echo > .git/bootstrap-role', 'echo chief-of-staff > .git/bootstrap-role', 'tee .git/bootstrap-role', 'cp r .git/bootstrap-role', 'Set-Content .git/bootstrap-role chief-of-staff', 'bootstrap role chief-of-staff', 'node .bootstrap/bin/bootstrap.mjs role chief-of-staff',
]) B(c);
console.log('--- role forging');
for (const c of ['BOOTSTRAP_ROLE=chief-of-staff git commit -m a', 'env BOOTSTRAP_ROLE=chief-of-staff git commit -m a', 'export BOOTSTRAP_ROLE=chief-of-staff', '$env:BOOTSTRAP_ROLE="chief-of-staff"', 'set BOOTSTRAP_ROLE=chief-of-staff', 'Set-Item env:BOOTSTRAP_ROLE chief-of-staff', 'R=BOOTSTRAP_ROLE; env $R=chief-of-staff git commit -m a', 'env "BOOTSTRAP_ROLE=chief-of-staff" git commit -m a',
  'BOOTSTRAP_RO""LE=chief-of-staff git commit -m a', '[Environment]::SetEnvironmentVariable("BOOTSTRAP_ROLE","chief-of-staff")', 'setx BOOTSTRAP_ROLE chief-of-staff', 'env -S "BOOTSTRAP_ROLE=chief-of-staff git commit"', 'env -i BOOTSTRAP_ROLE=chief-of-staff git commit -m a', 'bootstrap_role=chief-of-staff git commit -m a', 'declare -x BOOTSTRAP_ROLE=chief-of-staff', 'printenv BOOTSTRAP_ROLE=x']) B(c);
console.log(bad ? `MISMATCHES: ${bad}` : 'ALL MATCHED');
