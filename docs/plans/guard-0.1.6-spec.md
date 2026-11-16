---
title: Guard follow-ups for 0.1.6 (G-1 review findings), with tests
author: tech-lead
date: 2026-11-16
for: Builder (repo copy), then the plugin repository (see the end)
status: spec only. HIGH (guard, security controls): needs the owner's go before Builder starts. Code lines are from release/0.1.5 at 237f3e1.
related: docs/security/2026-11-16-g1-guard-review.md (G1-1 to G1-5), docs/plans/guard-gaps-spec.md, docs/plans/upstream-bootstrap-notes.md
---

# Order and size

| # | Item | Layer | Size | Source |
|---|---|---|---|---|
| 1 | `gh` publishing and merging (G1-1, HIGH) | shell rules | small | Security |
| 2 | Git config and alias writes, non-builtin subcommands (Chief's item 1, G1-3) | shell rules | medium | automated review |
| 3 | `toRepoPath` canonical paths, fail closed (Chief's item 2) | `lib/policy.mjs` | small | automated review |
| 4 | Record authentication at commit and push (Chief's item 3, G1-2) | `precommit.mjs`, `prepush.mjs` | medium | review, Security |
| 5 | Legacy skip-flag patterns no longer false-block (a side effect of the 237f3e1 fix) | `shellrules.mjs`, `policy.json` | small | seen today |
| 6 | Dynamic push target, role from environment (G1-4, G1-5) | shell rules, `precommit.mjs` | small | Security, LOW/MEDIUM |

One rule for all: **fail closed for roles outside `releases.live_pushers`, open for chief-of-staff, release-ops and hotfix** (they already may push main; their own limits are the pre-push scope check). A refusal says what to do instead, in one line.

## 1. `gh` writes (G1-1, HIGH)

Today `gh release create|upload|edit|delete`, `gh pr merge` and `gh api -X PATCH .../git/refs/heads/main` pass for every role, and a GitHub Release is what every installed copy auto-updates to. `scripts/release.mjs`'s own role check is skipped by calling `gh` directly.

**Rule** (in `shellrules`, on the tokenized simple command whose command word is `gh`, `gh.exe`, or a path ending in it):
- Refuse for a non-live role: `gh release` with any subcommand except `view`, `list`, `download`; `gh pr merge`, `gh pr close`, `gh pr ready`; `gh repo` with `edit`, `delete`, `rename`, `archive`, `sync`, `deploy-key`; `gh secret`, `gh variable`, `gh workflow run|enable|disable`; `gh ruleset`; `gh label delete`.
- `gh api`: allowed only when the effective method is GET. Effective method = `-X`/`--method` value, else POST when any of `-f`, `-F`, `--field`, `--raw-field`, `--input` is present, else GET. Refuse a dynamic method word, and `graphql` bodies that contain `mutation` (a `-f query=...` with that word).
- `gh alias set` and `gh extension install|exec` refused (they build a command the rule cannot read).
- Allow every other read: `gh pr view|list|checks|diff`, `gh run list|view`, `gh issue view|list`, `gh auth status`, `gh repo view`.
- Also read through wrappers: `env gh ...`, `command gh ...`, `npx gh`, and `& gh` in PowerShell, using the tokenizer's command-word finder that 237f3e1 already uses for `git`.

**Tests** (table-driven, role `builder`): deny `gh release create v9 x.zip`, `gh release delete v1 -y`, `gh release edit v1 --draft=false`, `gh pr merge 12 --squash`, `gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=x`, `gh api repos/o/r/releases -f tag_name=v9` (implied POST), `gh api graphql -f query='mutation{...}'`, `env gh release create v9`, `gh api -X $M repos/o/r`, `gh repo edit --visibility public`; allow `gh release view v1`, `gh release list`, `gh pr view 12`, `gh api repos/o/r/releases/latest`, `gh api -X GET repos/o/r`, a commit message or heredoc that merely contains `gh release create` (quoted text is data); role `release-ops`: `gh release create` allowed but `gh release delete` and `gh release edit` stay owner-only per AGENTS.md (refused for every role, the owner runs them); role `chief-of-staff`: allowed except those two.

## 2. Git config, alias and non-builtin subcommands

Today only `git -c alias.X=...` on the same command is read (`shellrules.mjs:126`). Gaps: a persisted alias, `include.path`, and push targets set by config.

**Rule** for a non-live role, on `git config` (also `git -c`, `GIT_CONFIG_*`, which already fail), and on writes to `.git/config` through any route that reaches the policy's protected-path check:
- Refuse setting `alias.*` when the value contains `commit`, `push`, `merge`, `rebase`, `am`, `cherry-pick`, or starts with `!` (a shell alias). Allow reading (`git config --get`, `--list`, `-l`) always.
- Refuse `include.path` and `includeIf.*.path` (they pull in another file that can carry any of the above); refuse `core.*` that runs programs or moves hooks: `hooksPath`, `fsmonitor`, `sshCommand`, `editor`, `pager`, `askPass`, `attributesFile`; refuse `credential.*.helper`, `url.*.insteadOf` and `url.*.pushInsteadOf`; refuse `remote.*.push`, `remote.*.mirror`, `remote.*.url` and `remote.*.pushurl` changes, `push.default`, `push.followTags`, `branch.*.pushRemote`, `branch.*.remote`.
- Refuse `git config --global/--system/--file <f>/--includes` writes entirely (not just those keys): a role has no reason to edit those scopes.
- **Non-builtin subcommands.** `git <word>` where `<word>` is not a git builtin: look the alias up with `git config --get alias.<word>` (a read, run by the guard at check time, with a 2 s limit) and run the same rules on the expanded command, recursively to depth 3. `git-<word>` external commands and `git <word>` for a word that is neither builtin nor a known alias: refuse for a non-live role ("unknown git subcommand"). Keep the builtin list in one file; `git help -a` output is the source for the first version.
- Also refuse `--git-dir`, `--work-tree`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` (G1-3), `commit-tree`, and `update-ref` writing `refs/heads/*`, `refs/tags/*`.

**Tests:** deny `git config alias.ci "commit -n"`, `git config alias.p "!git push origin main"`, `git config include.path ../x`, `git config includeIf.gitdir:/a/.path ../x`, `git config remote.origin.push HEAD:main`, `git config remote.origin.mirror true`, `git config push.default matching`, `git config --global core.hooksPath x`, `git config --file other alias.x y`; allow `git config --get alias.ci`, `git config -l`, `git config user.email a@b` (identity keys are fine in the worktree scope); alias resolution: set `alias.ci=commit -n` in a scratch repo, then `git ci` is refused with the alias named; `alias.st=status` allows `git st`; unknown `git frobnicate` refused; `GIT_DIR=x git commit` refused; chief-of-staff allowed all of the above except the skip flag itself.

## 3. `toRepoPath` canonical form, fail closed

Today it works on the text (plus a native-realpath lookup only when `~\d` appears). A link, junction, `\\?\` prefix, case variant or 8.3 name inside the path can point a "docs/" write at `.bootstrap/`, and a path that cannot be read returns the text form (fail open).

**Rule** (`lib/policy.mjs`, replace the body, keep the signature plus an options argument for tests):
1. Reject (return a `{ refused }` result, not null) a path with NUL.
2. Strip `\\?\` and `\\.\` prefixes (and `\\?\UNC\`) from both inputs before anything else.
3. Canonicalise the root once with `realpathSync.native`. For the target: `realpathSync.native` of the path; when it does not exist, canonicalise the **nearest existing parent** and append the remaining segments (this follows a junction in the middle of the path, which the text form misses).
4. If neither the target nor any parent can be canonicalised (permission, broken link, loop): **fail closed**, return refused. Today's "not ours to police" null is kept only for a path that canonicalises successfully to outside the repo.
5. Compare case-insensitively on Windows (keep the existing segment clean-up for trailing dots and spaces, ADS, which `realpath` does not normalise for non-existent names).
6. Cache by the string for the life of one hook call (the file-tool hook runs per call, so no long-lived cache).
Callers (`guard.mjs:105`, `shellwrites.mjs:128`) treat `refused` as a block with the reason "that path could not be read safely".

**Tests** (win32 and posix, `p` injected where the file system is not needed; a real junction/symlink test skipped when links cannot be made): `docs/a.md` inside; `docs/../.bootstrap/x` normalised to `.bootstrap/x`; a junction `docs/j` to `.bootstrap`, write `docs/j/x.mjs` resolves to `.bootstrap/x.mjs` and is refused for builder; `\\?\D:\repo\.bootstrap\x`; `\\.\D:\repo\.bootstrap\x`; `D:\REPO\.BOOTSTRAP\x` (case); `.bootstrap.\x`, `.bootstrap \x`, `.bootstrap::$DATA`; `BOOTST~1\x`; a non-existent file in a non-existent folder under a junction; a path under a folder with no read permission (fail closed); NUL; a symlink loop (fail closed); a drive-relative `C:x`; a UNC path outside; a path outside the repo that canonicalises fine (null, as today); performance: 2000 calls under 2 s.

## 4. Records authenticated at commit and push (G1-2, MEDIUM)

Today any role with `docs/**` can hand-write another role's sign-off or `_required.md`, and `completeSignoffs` trusts filenames. Pre-commit does not look at records (A1 is the authoritative layer).

**Rule** in `precommit.mjs` (staged files, `git diff --cached --name-status`), and the same function re-run in `prepush.mjs` over the pushed range (so a commit made with hooks off is caught at push):
- A staged path under `docs/signoffs/<piece>/<name>.md` (add, modify, delete, rename): allowed for role R only when `<name>` equals R **and** the file's front matter `role:` equals R, **and** (for add/modify) the file parses with `verdict`, `sha`, `date`. chief-of-staff may write any `<name>` except it may not change another role's `verdict`/`sha` (it may add `_piece.md` and `_required.md`); a deleted or renamed sign-off is refused for everyone but chief-of-staff, and chief-of-staff's deletion is allowed only with the line `removed-by: chief-of-staff, reason: ...` recorded in the commit message trailer.
- `docs/signoffs/<piece>/_required.md` and `_piece.md`: chief-of-staff only; security may add a role to `_required.md` for the pieces it names, never remove one.
- `docs/releases/**`: chief-of-staff; release-ops only its own `docs/releases/<version>-release-ops.md`-style record (name pattern fixed in `policy.json` `records.owner_patterns`).
- `completeSignoffs` (`prepush.mjs:35`) also requires `filename stem === data.role`; a mismatch is "forged or misnamed", counted as missing and named in the error.
- The role comes from the same source as the rest of the commit-time checks. Until item 6 moves the role out of the environment, this check is a seatbelt, not proof; say so in the README line it touches.

**Tests:** builder stages `docs/signoffs/x/qa.md` (refused); builder stages its own with `role: qa` inside (refused); builder stages its own, matching (allowed, with its `verdict`, `sha`, `date`); security adds `_required.md` entry (allowed), removes one (refused); chief-of-staff stages `docs/signoffs/x/qa.md` (allowed, since the CLI is how it records a relayed sign-off) but a modify that flips another role's `verdict` is refused; delete of a sign-off by builder (refused); rename `qa.md` to `security.md` (refused); `completeSignoffs` with `security.md` whose front matter says `role: qa` (not counted, error names the file); a normal CLI sign-off flow end to end (unaffected); a pre-push range containing a forged sign-off made with the hook skipped (refused at push).

## 5. The 237f3e1 side effect: legacy patterns false-block again

Applying `deny_all` always (the right fix for ANSI-C quoting) means the whole-string regexes (`-f` push, `--no-verify`, `core.hooksPath`, `\bgit\b...-n`) fire on quoted text and on unrelated chained commands. Seen today: `git push -q origin HEAD; git worktree remove --force <dir>` was refused by the `git push ... --force` pattern because the two commands share one string (gap C/E again).

**Rule:** run each `deny_all` pattern against **each simple command's text separately** (the tokenizer already returns them), with quoted spans and here-document bodies blanked to spaces first, but keep the raw string for `$'...'` and `$"..."` forms (the reason for 237f3e1). Then `git push` in one simple command and `git worktree remove --force` in the next no longer meet. Keep one whole-string pass only for patterns marked `"whole": true` (the `GIT_CONFIG_*` ones).
**Tests:** allow `git push -q origin HEAD; git worktree remove --force d`; allow `echo "do not use --no-verify"`; allow `git commit -m "mentions --no-verify"`; still deny `git commit --no-verify`, `git commit -$'n'`, `git push origin x --force`, `git -c core.hooksPath=/dev/null push`; deny `echo x; git commit -n`.

## 6. Smaller (G1-4, G1-5)

- A `git push` whose refspec word is dynamic (`$(...)`, `$M`, `${B:-main}`) is refused for a non-live role.
- `env <dynamic>=...` and `$R=BOOTSTRAP_ROLE`-style names are refused; `precommit` reads the role from a file the guard writes into the worktree's private git dir (`.git/bootstrap-role`, set by `bootstrap role` at session start), falling back to the environment only if the file is absent, with the mismatch logged.
- `rm`/`mv`/`Remove-Item`/`Move-Item` of `.githooks`, `.bootstrap`, `.git/hooks` or any parent of them is a protected write; `bootstrap doctor` and the gate fail when `.githooks/pre-commit` is missing or `core.hooksPath` is not `.githooks`.

# For the plugin repository (upstream)

Items 1 to 6 are plugin faults too (the repo copy came from it). The order there: tokenizer-based command-word finder (exists in the repo copy, port it), then 5 and 1 (daily false blocks and the publishing path), then 3 and 2, then 4 and 6. Item 4 needs the same `_piece.md` schema work as upstream item F, so do them together. Tests above go into the plugin's `tests/` unchanged.
