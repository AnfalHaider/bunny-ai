---
title: K-1 pre-review of bootstrap kit 0.6.0 (what a plain upgrade would do to our guard)
author: tech-lead
date: 2026-11-17
for: Builder A (port in scripts/kit-next on claude/builder-a-k1), Security, the Chief of Staff
status: read-only audit of the installed 0.6.0 files. Nothing run, nothing written to the plugin. Paths are relative to the plugin's `bin/`
          (C:/Users/anfal/.claude/plugins/cache/bootstrap-environment/bootstrap-environment/0.6.0/bin/). Line numbers are from that copy.
---

# What a plain `bootstrap upgrade` to 0.6.0 does to our setup

`init` (which `upgrade` runs) **overwrites everything under `.bootstrap/bin`** (`bootstrap.mjs:63`, `copyTree(... { overwrite: true })`) and also
`.bootstrap/flow`, `.bootstrap/ui`. It keeps `policy.json` (`writeOnce`, `bootstrap.mjs:93`), `.githooks/pre-push` (`writeOnce`, `:101`) and role briefs.
Extra files we added in `.bootstrap/bin/lib` (shellparse, shellrules, shellwrites) and `precommit.mjs` are not deleted, but nothing in the 0.6.0 files calls them.

You listed three losses (tokenizer path in guard.mjs, case-insensitive globs and Windows paths in policy.mjs, `PLAIN_ID` in bootstrap.mjs). All three are confirmed.
The list below is everything else I found, plus the exact lines of those three. "G-1" = what we have today (guard-next as landed). Severity: H = the port must fix it
or the upgrade must not land; M = fix in the port or write down why not; L = note.

## Confirmed: the three losses

1. **(H) Shell checks go back to whole-string regexes.** `guard.mjs:51` (`WRITE_OPS`) and `:84-87` test the entire command; `:132-137` run `deny_all` as regexes on the whole
   string; `:23-45` `pushTargets` splits only on `&& || ; \n`, takes the first non-flag word as the remote, so `git push --repo=origin main`, `git -C x push`,
   quoted refspecs and a leading option value are misread. `:75` takes the rest of the line as the sign-off CLI's options (E). No tag, remote-url, bare-URL,
   `gh`, `symbolic-ref`, `checkout-index`, `worktree add -B` rule exists. **Also: our `policy.json` moved `--no-verify` and `core.hooksPath` to `legacy_deny_all`** (the tokenizer path reads it);
   0.6.0 reads only `deny_all`, `destructive_commands` and the role's `deny_commands` (`guard.mjs:132`), so after a plain upgrade the hook-skip protection is **gone**, not just weaker.
2. **(H) Paths.** `policy.mjs:106-107` + `:90-103`: `globToRegex` returns a case-sensitive regex, so `.Bootstrap/bin/x`, `agents.MD` or `.GITHOOKS/pre-push` are not protected on Windows.
   `policy.mjs:110-113` `toRepoPath` does no Windows cleanup (trailing dots and spaces, `:stream`, 8.3 names, junctions) and returns a drive-letter path for another drive.
   `guard.mjs:151`: `if (rel.startsWith('..')) return { allow: true }` treats a file named `..foo.md` **inside** the repo as outside it (not policed at all).
3. **(H) `PLAIN_ID`.** `bootstrap.mjs:249-254` (`signoff`): `piece` and `--role` go straight into `join(root,'docs','signoffs',piece,`${r}.md`)`. A piece of `../../.bootstrap/roles`
   writes `.bootstrap/roles/<role>.md` (it would replace a role brief, i.e. its `write_globs`); a role of `../../src/x` writes `src/x.md`. The same unvalidated ids reach `approve` (`:271`),
   `require` (`:279`) and `piece` (`:322`). The CLI is run by sessions, so this is the file-write path around the guard's own record rules.

## Not in your list

4. **(H) Role lookup lost our git-dir role file.** `policy.mjs:73-80` `currentRole`: `BOOTSTRAP_ROLE`, else `.bootstrap/session.json`, else `unassigned`. We moved the role to
   `<git dir>/bootstrap-role` (file wins). After the upgrade every session reads `session.json` instead, and `bootstrap role` (`bootstrap.mjs:157-162`) writes only that and has **no "a session that
   already has a role does not change it"** refusal. Worse: `mustBe` (`bootstrap.mjs:234-238`) and `signoff` (`:243-245`) treat `unassigned` as "the owner outside a session" and allow
   `upgrade`, `kit apply`, `piece`, `approve`, and `signoff --role <anyone>`. The hook's check at `guard.mjs:79-81` blocks `unassigned` signing and non-listed roles, but a session whose
   `session.json` is missing or deleted becomes `unassigned` and the CLI called directly (not through the hook) accepts it. **Port must keep `roleFile` (policy.mjs of G-1) and the no-change refusal.**
5. **(H) Kit-only pushes skip sign-offs and the release record.** `prepush.mjs:56-57` `KIT_UPGRADE_GLOBS` = `.bootstrap/bin/**`, `.bootstrap/flow/**`, `.bootstrap/ui/**`, `.bootstrap/roles/**`, `.bootstrap/kit.json`,
   `.githooks/**`, `.claude/settings.json`, `.gitignore`. A push whose commits touch only these (plus docs) is `configOnly` (`:227-229`); `:250` then **removes those commits from `codeCommits`**, so
   neither `:254-264` (release record 7E) nor `:266-279` (complete sign-offs, O10) applies. The only requirement is a `docs/kit-changes/*.md` with owner words and the sha256 of each file (`:64-70`, `:241-249`),
   which only the Chief of Staff can write (`guard.mjs:65`). That means the guard, the hooks, the role briefs and `settings.json` can reach `main` with **one** session's record and no independent review.
   For K-1 itself that would let the port land without Security's sign-off. **Port must not ship this exemption for `.bootstrap/bin/**`, `.githooks/**`, `.claude/settings.json`**
   (remove them from the glob list or add a policy switch, default off for those), and keep our sign-off rule for them.
6. **(M) Whole-repo `*.md` is "docs".** `policy.mjs:10` default `docs_globs` includes `**/*.md`; our `policy.json` does not override `docs_globs`. A commit touching only `*.md` is never a "code commit" at push
   (`prepush.mjs:214`). That includes `.bootstrap/roles/*.md` (the briefs carry `write_globs` and `deny_commands` in front matter) and `AGENTS.md` / `CLAUDE.md`. The guard protects the writes
   (`guard.mjs:154`, case-sensitively, see 2), but the push check gives no second line for them. Add `.bootstrap/**`, `AGENTS.md`, `CLAUDE.md` to the non-docs side.
7. **(H) The upgrade turns on the lane model for us.** `bootstrap.mjs:92` `writeOnce(.bootstrap/flow.json, { preset: 'full' })`. From then on `flowFor` (`prepush.mjs:163-169`) returns a flow and
   `completeSignoffs` (`:138`) refuses any piece without a `_piece.md` lane (`bootstrap piece <id> --lane`, Chief of Staff only): "no lane set". Every existing piece (`docs/signoffs/*`, written for the
   old "default_required" model) fails this check, so the first push of ordinary code to `main` after the upgrade is refused until lanes are set. Also `ops.mjs:116-118` `hasEvidence`: a PASS with a
   body under 20 characters is ignored (`prepush.mjs:114-115`). **Builder must prove a normally signed piece still passes a push to main on the upgraded kit, or choose to ship without a `flow.json`.**
   UNKNOWN: whether `flow/rules.json` conditions would require Security for guard files (I did not read `flow/defaults.json` in full).
8. **(M) Push allowance widened.** `bootstrap.mjs:114-125` adds `Bash(git push:*)`, `Bash(node .bootstrap/bin/bootstrap.mjs:*)`, `Bash(node .bootstrap/bin/mem.mjs:*)` to
   `.claude/settings.json` permissions.allow. Ours today: `git add`, `git commit`, `git push origin claude/:*`, `git push -u origin claude/:*` only. After the upgrade any session can push **any** ref with no click
   (the guard and the pre-push hook still run, but the click was a third gate for `main`, tags and other remotes), and run the `bootstrap` CLI unprompted. The setting is also a `KIT_UPGRADE_GLOBS` file (item 5).
   **Port must not add the broad `git push:*`; keep `claude/` only. Do keep it from being re-added on every later `upgrade`** (the code re-adds it whenever it is missing, `:118`).
9. **(M) The plugin's own hook still runs the 0.6.0 regex guard for every session.** `hooks/hooks.json` runs `${CLAUDE_PLUGIN_ROOT}/bin/guard.mjs` (the plugin copy, not `.bootstrap/bin`) on every tool call,
   in addition to our project hook. Porting G-1 into `.bootstrap/bin` does **not** remove the false blocks seen daily (they come from that copy), and it cannot be relied on for the new checks either
   (it only adds blocks). Our project hook matcher (`.claude/settings.json`) lacks `Agent|Task`, so the helper cap is enforced only by the plugin hook. Decide who owns this (upstream report, or disable the plugin's hook for this project).
10. **(M) `prepush.mjs` loses G-1's second line.** No A1 scope check at push (`scope_check.push`, `push_exempt_roles`), no rule for **tag** pushes or deletions (only `live` and `dev` deletion is refused, `:194`;
    a tag ref is not `guarded`, `:192`, so only conflict markers are checked), role read from `currentRole` (item 4). Port must carry our `prepush.mjs` additions (W5B-5 tag rule, scope check) forward.
11. **(M) `enabledPlugins` re-enable (D) is unchanged.** `bootstrap.mjs:181`: `s.enabledPlugins[id2] = name === 'bootstrap-environment' || kit.some(...)` still writes `true` for a plugin the project turned off. Fix as in
    `docs/plans/upstream-bootstrap-notes.md` section D (`projectValue === true && kitMatches`).
12. **(L) New helper rule.** `guard.mjs:94-107`: at most 2 helper agents per session, and only on `haiku`; a `fork` is refused. This agrees with what the Chief of Staff relayed, but a helper call that names another model
    is blocked, and `.bootstrap/helpers/<session>.json` is created on the first start (git-ignored by `init`). Tell the sessions.
13. **(L) Policy merge is shallow.** `policy.mjs:60-71`: our extra keys (`shell_parse`, `shell_write_check`, `scope_check`, `records`, `legacy_deny_all`) survive in the file but are ignored by 0.6.0 code;
    `deny_all` in our file replaces the default list (not merged). `releases.live_pushers` **is** kept: `...user.releases` (`:69`), and the default also lists `chief-of-staff`, same as ours. `branches.dev` = `main` in our file; 0.6.0 treats that as a dev branch equal to live (`prepush.mjs:192`), which is harmless.

## What the port's review will check (so Builder A can aim at it)

- A. `guard.mjs`: the G-1 tokenizer path is intact; `legacy_deny_all` is applied when a command cannot be parsed or `shell_parse` is false; `pushTargets` is G-1's; helper check kept; record rules unchanged.
- B. `lib/policy.mjs`: `roleFile`, case-insensitive protected globs, `toRepoPath` (canonical, strips `\\?\`, trailing dots/spaces, streams, 8.3, null outside), `isRoleFile`; `rel.startsWith('..')` replaced by a path-segment test.
- C. `bootstrap.mjs`: `PLAIN_ID` on piece, role, ids in `approve`, `require`, `piece`; a session with a role does not change it; `unassigned` is not "the owner" for the CLI's privileged commands.
- D. `prepush.mjs`: G-1's tag rule and scope check; the kit-only exemption narrowed (item 5); `.bootstrap/**`/`AGENTS.md` not docs (item 6); role via `roleFile`.
- E. `init`/`upgrade`: no broad `git push:*`; `flow.json` decision (item 7) with a proof push; `policy.json` and `.githooks/pre-push`, `.githooks/pre-commit` kept; `docs/kit-changes` record written by the Chief of Staff on the owner's word.
- F. A proof from a fresh worktree: ordinary commit, push of a `claude/*` branch, a signed piece to `main` by `release-ops`, and the refusals (hook-skip flags, tag push, `Main`, a `..foo.md` write, `PLAIN_ID` traversal) all behave as today.

## UNKNOWN (not checked)

- `flow/defaults.json` and `flow/rules.json` in full (which roles each file condition requires), `lib/flow.mjs` (lane and company-floor logic), `lib/ops.mjs` beyond `hasEvidence`, `flow-ui.mjs` (the local editor's HTTP surface), `adapt.mjs`, `mem.mjs`, `githooks/pre-push` in the kit, `tests/`.
- Whether the plugin's own `hooks.json` guard also runs for Builder's worktrees (it does for any session with the plugin enabled; role narrowing in `bootstrap role` keeps it on).
