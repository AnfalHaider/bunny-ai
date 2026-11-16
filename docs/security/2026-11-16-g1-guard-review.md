# G-1 guard rework — Security review

Date: 2026-11-16 · Session: Security · Reviewed: `560e636` on `claude/builder-efa9a9` (staged under `scripts/guard-next/`; Tech Lead PASS `b866ac1`).
Method: read of `guard.mjs`, `lib/policy.mjs`, `lib/shellrules.mjs`, `precommit.mjs`, `prepush.mjs` and the README; their 70 guard-next tests (pass, run here); then my own probes against throwaway git repos in the temp folder, never the real repo. The probe scripts are in `docs/security/g1-probe/` (`node probe1.mjs <checkout of 560e636>`; probes 2 and 3 likewise). Nothing was changed in the guard. The sign-off itself waits for the final release sha.

## Verdict (for the log): **PASS with conditions**

G-1 does what it set out to do, and the false blocks it targets are gone. I found four gaps the spec did not list, two of which I would close before the guard is called done. None is a regression: each is a hole the live guard has today too.

## What I tried and what held

| Group | Result |
|---|---|
| Push of `main` by a non-live role: `origin main`, `HEAD:main`, `HEAD:refs/heads/main`, `feat:main`, `+main`, `--delete origin main`, `:main`, `refs/heads/x:refs/heads/main`, a URL remote, `git -C . push`, quoted `"ma"in`, `--all`, `--mirror`, wildcard refspec | all refused |
| Pushing a normal branch (`claude/x`, `-u origin HEAD`, `refs/heads/claude/x`) | allowed |
| Hook skips: the long flag and its prefixes, `-n`, `-nm`, `-m x -n`, `-c core.hooksPath=…`, attached `-ccore…`, `--config-env`, `git config core.hooksPath` (local and global), the same on push and merge, `.git/hooks/*` and `.git/config` writes | all refused |
| Forging the role in a command: `env BOOTSTRAP_ROLE=…`, `export …`, `bootstrap role …`, writing `session.json` by `echo >` or `tee` | refused |
| Shell writes outside scope (tech-lead, security): `cp`, `sed -i`, `>>`, `tee`, `Set-Content`, `mv`, `touch .bootstrap/x`; records folders by `echo >` and `cp` | refused |
| Bootstrap CLI: signing for another role, a path as piece id, `require` by a role that may not | refused; signing for itself and Security's `require` allowed |
| File tools: protected files in every case form (`.BOOTSTRAP`, `.bootstrap.`, `..` segments, `::$DATA`, `:ads`, `agents.md`), records, other roles' scope | refused; own scope and `.claude/settings.local.json` allowed |
| Commit time (A1): staged edit or delete of `.githooks/pre-commit`; `src/` by tech-lead or security | refused |
| False blocks, 26 normal commands (commit messages and heredocs that quote a skip flag or `git push origin main`, `git log -n`, `git merge --no-ff`, `cherry-pick -n`, `git diff -n`, `git push -u origin claude/…`, worktree, stash, python heredoc into `docs/`, `bootstrap signoff … --note "see docs/signoffs/…"`) | none blocked |
| This session's own live false blocks, asked of the staged guard (probe 3) | all four now allowed: a write to a scratch folder outside the repo; a heredoc whose body mentions a skip flag and a main push; a commit message quoting the flag; `git log --grep` with it |

Count: probe 1 had 124 expectations; 104 matched. The 20 mismatches are the findings below, plus expectations I set too strictly (listed under "Not findings").

## Findings

### G1-1 HIGH — publishing through `gh` is not guarded
`gh release create|upload|edit|delete`, `gh pr merge`, and `gh api -X PATCH …/git/refs/heads/main` are all allowed for a builder (probe 1). Every installed copy auto-updates from a GitHub Release, so `gh release create v9 …` by any role is a release. AGENTS.md ("Routine-looking destructive commands") says `gh release delete/edit` are owner-only and `npm run release` is refused by role, but nothing in the staged or live `policy.json` blocks the `gh` forms, and `scripts/release.mjs`'s own role check is skipped by calling `gh` directly. This is the "pushes main" route the guard does not see.
**Recommend (Builder, on the Chief of Staff's landing):** add to `shellrules`: for roles outside `releases.live_pushers`, refuse `gh release *` (except `view`/`list`), `gh pr merge`, `gh api` with a method other than GET, and `gh repo` settings writes; and keep `gh` read-only calls open. Test for each.

### G1-2 MEDIUM — records are not authenticated at commit time
Any role that may write `docs/**` can hand-write or edit another role's sign-off, a release record or `_required.md` and commit it: all four attempts passed `precommit.mjs` (probe 2). The pre-push check reads those files to decide whether code is signed, so a forged QA PASS at the right sha satisfies it. The file-tool and shell rules stop the casual route; `node -e`, a script or `git apply` are not read (the README says A2 is a seatbelt), and A1, the layer that is supposed to be authoritative, does not look at records (README: "Not part of the commit-time check").
**Recommend:** in `precommit.mjs` and the push backstop, for a staged path `docs/signoffs/<piece>/<name>.md`, require that the committer's role equals `<name>` (or is chief-of-staff), and that the file's `role:` front matter equals `<name>`; `_required.md` and `docs/releases/**` only chief-of-staff (and release-ops for its own record). A role's own sign-off is already written by the CLI, so normal work is unaffected.

### G1-3 MEDIUM — the hooks themselves can be switched off without touching a protected file
- `rm -rf .githooks` and `mv .githooks …` are allowed (probe 1): the rule protects files under `.githooks/**`, not the folder. Git skips a missing hooks folder silently, so after that the pre-commit and pre-push checks do not run in that checkout.
- `git config alias.ci "commit -n"` is allowed, and then `git ci` skips the hook (the alias check only looks at `-c alias.*` on the same command).
- `git --git-dir=<other> commit`, `GIT_DIR=… git commit` and `git commit-tree` + `update-ref` make commits with other or no hooks.
Mitigations that exist: the pre-push scope backstop still sees the pusher's own first-parent commits (not for release-ops, hotfix, chief-of-staff), and `main` cannot be pushed by these roles. So the damage is out-of-scope commits on a side branch that a reviewer must spot, and a checkout with no hooks until someone notices.
**Recommend:** treat `rm`/`mv`/`Remove-Item`/`Move-Item` of `.githooks`, `.bootstrap`, `.git/hooks` and any parent of a protected path as a protected write; refuse `git config` setting `alias.*`, `core.*` (hooksPath, and `core.fsmonitor`/`core.sshCommand` which run programs), and refuse `--git-dir`, `--work-tree` and `GIT_DIR` for non-chief roles; refuse `commit-tree`/`update-ref` writes to `refs/heads/*`. Have `bootstrap doctor` or the gate fail if `.githooks/pre-commit` is missing or `core.hooksPath` is not set.

### G1-4 MEDIUM — a push target built from a variable is not read
`git push origin $(echo main)`, `M=main; git push origin $M` and `HEAD:${B:-main}` are allowed (probe 1); the README admits dynamic write targets fail open but not dynamic push targets. The pre-push hook refuses `main` for a non-live role, so this is a second layer failing, not a hole to `main`, but the shell layer is the one that gives a clear message and the README claims it covers pushes.
**Recommend:** the tokenizer already flags dynamic words; for a non-live role refuse a `git push` whose refspec word is dynamic.

### G1-5 LOW — the role-from-command rule is a name match
`R=BOOTSTRAP_ROLE; env $R=chief-of-staff git commit …` is allowed: the rule looks for the literal word at the start of a token. The README already says the role "is only as strong as the agent's cooperation". Two cheap hardenings: refuse `env` with a dynamic assignment name, and make `precommit` read the role from the checkout's git worktree config or a file the guard writes, not the process environment, so a changed variable cannot raise a role at commit time.

### Observations (no action needed or accepted by the README)
- Fail-open on a broken `policy.json` or a missing role file (probe 2: a src commit was allowed): needs a write to `.bootstrap/**` first, which is protected, so it is reachable only through the documented `node -e` gap. A line in the gate (`policy.json` parses; every role file exists) would turn this from silent to loud.
- The 8.3 short-name check only resolves names that already exist (README). My probe used a malformed short name; inconclusive, not a finding.
- `A2` seatbelt limits, `node -e` / `python -c` / MCP / subagent writes, symlinks and junctions: as the README says; A1 at commit is the answer, which G1-2 and G1-3 are about hardening.
- Tags: `git push origin v1.0.0` is allowed. A tag by itself ships nothing here; it matters only with a workflow that releases on tags (there is none). Informational.
- `npm run release` / `node scripts/release.mjs` are allowed by the guard; the script refuses by role itself (checked at `scripts/release.mjs:33-37`). Fine, but the same role-from-environment weakness as G1-5 applies to it.

## Not findings (my expectations were too strict)
The `git ci` alias is reported under G1-3 as an actual hole; `git push origin v1.0.0` is informational; `npm run release` is guarded by the script; `.bootstr~1` was my malformed test.

## Recommendation to the Chief of Staff
Landing G-1 as staged is an improvement on the live guard in every probe, and the false blocks that cost this session real work (the skip-flag text in a command, writes to a scratch folder) are fixed. Land it, and file G1-1 as the next guard row before anyone treats "the guard blocks pushing and publishing" as true: G1-1 and G1-2 are the two I would not leave open. Landing G-1 touches `.bootstrap/**` and `.githooks/**`, which is HIGH and the owner's go ("Guard-gap go" in AGENTS.md covers it, per the README).
