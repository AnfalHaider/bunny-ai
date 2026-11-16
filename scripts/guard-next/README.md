# guard-next: staged guard changes (board row G-1)

Built by the Builder in a staging folder because `.bootstrap/**` and `.githooks/**` are protected (only the
Chief of Staff lands changes there, on the owner's word: AGENTS.md "Guard-gap go"). The files here mirror their
target paths. Spec: Tech Lead's `docs/plans/guard-gaps-spec.md` (a012c6f). Tests: `test/guard-next*.test.js`
(they import these files, never the live ones).

## What is here, and which item it closes

| Staged file | Target | Items |
|---|---|---|
| `.bootstrap/bin/lib/policy.mjs` | same | **B** `toRepoPath` returns `null` outside the repo (cross-drive, UNC, `..\x`), keeps `..foo.md` inside, strips Windows trailing dots/spaces and `:streams`, resolves 8.3 names; `scopeViolation` (one scope rule), `scopeViolations`, `recordViolation`; protected paths compared case-insensitively; chief-of-staff is not bound by `write_globs` on protected paths |
| `.bootstrap/bin/lib/shellparse.mjs` | new | **tokenizer**: quote-aware, heredoc/here-string aware, `$(..)`, redirections as separate items, `uncertain` flag |
| `.bootstrap/bin/lib/shellrules.mjs` | new | **C**, **A3**, **A5** (hook skips, hooks folder, role from a command, role change), push targets, force pushes, `bootstrap` CLI rules (**E c**) |
| `.bootstrap/bin/lib/shellwrites.mjs` | new | **A2**, **E** (shell write targets; record folders) |
| `.bootstrap/bin/guard.mjs` | same | wires the above; file tools also get the record-folder rule |
| `.bootstrap/bin/precommit.mjs` + `.githooks/pre-commit` | new | **A1** commit-time scope check on staged paths |
| `.bootstrap/bin/prepush.mjs` | same | **A1** push-time backstop |
| `.bootstrap/bin/bootstrap.mjs` | same | **D** kit narrowing never widens; `signoff`/`require` reject path-like ids; a role signs only for itself (Chief of Staff for anyone) |
| `.bootstrap/policy.json` | same | new switches and lists (below); hook-skip regexes moved to `legacy_deny_all` |
| `.bootstrap/bin/lib/fm.mjs`, `.githooks/pre-push` | unchanged copies | so relative imports resolve here |

## Policy keys added

`shell_parse` (default true; false restores the old regexes), `shell_write_check` (default true: A2 and E on shell
commands), `scope_check.{commit,push,push_exempt_roles}`, `records.{globs,writers}`, `legacy_deny_all` (the old hook-skip
regexes, applied when a command cannot be read with confidence or `shell_parse` is false), `protected_globs` now also
`.git/config` and `.git/hooks/**`.

## Landing it (Chief of Staff)

1. `diff -r scripts/guard-next/.bootstrap .bootstrap` and `diff -r scripts/guard-next/.githooks .githooks`: confirm
   nothing live changed since staging (the staged `policy.json` is the 0.1.4-era copy plus the keys above).
2. Copy every file in the table to its target in one commit as chief-of-staff, **including `scripts/guard-next/.gitattributes`
   to the repo root** (`.githooks/* text eol=lf`; `core.autocrlf` is `true` on this machine, so without it the checked-out
   hooks get CRLF). The root `.gitattributes` already carries the same rule for the staged folder, so the tests pass on a CRLF
   checkout; after copying, run `git add --renormalize .githooks`.
3. Make the new hook executable: `git update-index --chmod=+x .githooks/pre-commit`. `bootstrap init` should also write `.githooks/pre-commit`
   (the toolkit's `init` only writes `pre-push`).
4. Run `node scripts/gate.mjs`; the `test/guard-next*.test.js` files keep testing the staged copies, so after landing
   either delete the staging folder and point `test/guard-helpers.js` `NEXT` at the repo root, or keep both identical.

## Honest limits (read before relying on it)

- **A2 is a seatbelt.** `node -e`, `python -c`, a script the agent just wrote, `npm run <x>`, `git apply`, `curl -o` and
  anything through an MCP tool or a subagent (**A4**) are not read. **A1 at commit time is the authoritative layer**:
  it sees what actually changed, whatever tool changed it. Uncommitted edits by those routes are not caught until commit.
- **A5.** The role comes from `BOOTSTRAP_ROLE` or `.bootstrap/session.json`, so it is only as strong as the agent's cooperation:
  the shell rules refuse setting the variable and changing the role, and `session.json` is under `.bootstrap/**` so file
  tools and shell writes to it are refused, but a write by `node -e` is not seen until commit (and `session.json` is not tracked).
- **Push backstop.** Only first-parent, non-merge commits are checked against the pusher's role, and roles in
  `scope_check.push_exempt_roles` (release-ops, hotfix, chief-of-staff) are not re-checked, because their job is to move other
  roles' commits. Work merged in from another branch is judged at its own commit. Tech Lead: confirm the exempt list.
- **Fail open on its own bugs.** `precommit.mjs` does not block on an internal error (it says so loudly); if
  `policy.json` is unreadable it still holds the built-in protected paths.
- **Records.** Only `chief-of-staff` writes `docs/signoffs/**` and `docs/releases/**` directly (file tools and shell);
  everyone else uses `bootstrap signoff|require|release`. This matches what the plugin guard already says; confirm no role
  writes those folders another way.
- **Symlinks and junctions** inside the repo are not followed (item B2, not built): a write through a link that points at a protected path is judged by the link's name. A1 at commit time sees the real change.
- **The "require" sub-command** (which roles must sign a piece) is for chief-of-staff and security only, in the shell rule and in the command itself, as the plugin guard has it (Tech Lead confirmed; their role does not write `_required.md`).
- **Variable write targets** (`echo x > $p`, `Set-Content $p x`) are not blocked unless their text names a protected path or a record folder: the seatbelt fails open there and A1 catches the change at commit. Tech Lead's spec said fail closed; accepted as fail open.
- **Push of everything** (`--all`, `--mirror`, a wildcard refspec) is refused in the shell for roles outside `releases.live_pushers`; the pre-push hook is the backstop.
- **Windows names.** 8.3 short names are resolved only when the file already exists; junctions and symlinks are not
  followed (spec item B2, not built).

## Report upstream (plugin guard, outside this repo; not edited here)

The bootstrap-environment plugin's own guard (plugin cache, `0.4.0/bin/guard.mjs`) has the same shell false blocks: its write
regex is tested against the whole command string, any `docs/signoffs/...` path in the string is then judged a write target,
and its sign-off CLI rule reads the rest of the line as the sign-off's options. The tokenizer and the corrected checks in
`lib/shellparse.mjs`, `lib/shellrules.mjs` and `lib/shellwrites.mjs` are written to be lifted into it. Items **C**, **A3**
and **E** should be reported to the plugin's source; the owner or Chief of Staff names it.

---

# The 0.1.6 guard round (W5-1): what changed in this folder

This folder was re-copied from the live guard (landed 237f3e1) and changed for Tech Lead's spec `docs/plans/guard-0.1.6-spec.md`.
Tests: `test/guard-016-*.test.js` (they import THIS folder, never the live files); `GUARD_STAGED=1 node --test test/guard-next*.test.js`
runs the older suites against this folder too (what the Chief of Staff will land must pass both).

| Item | Where | What |
|---|---|---|
| 1 `gh` writes (G1-1) | `lib/shellrules.mjs` (`refuseGh`) | Release publishing, `pr merge`, repo/secret/workflow/ruleset writes, `gh api` writes, `alias`, `extension`, `auth token`: live pushers only. `gh release delete/edit/delete-asset`, `upload --clobber` and API writes to releases or tag refs: nobody but the owner (every role). Read through `env`, `command`, `npx`, `xargs`, `timeout`... |
| 2 git config, aliases, subcommands (G1-3) | `lib/shellgit.mjs`, `lib/shellrules.mjs` | `alias.*`, `include.path`, `core.hooksPath/fsmonitor/sshCommand/editor/pager/askPass/attributesFile`, `credential.*.helper`, `url.*.insteadOf`, `remote.*.push/mirror/url`, `push.default`... refused for non-live roles, from `git config` (incl. `set`, `edit`, `rename-section`) and `git -c`; `--global/--system/--file` writes refused; `--git-dir`/`--work-tree` and `GIT_DIR`, `GIT_CONFIG_*`, `GIT_EDITOR`... refused; `commit-tree`, `update-ref` on branches/tags refused; unknown subcommands refused, an alias is expanded (in the `-C` folder) and judged to depth 3 |
| 3 `toRepoPath` | `lib/policy.mjs` | Canonical (links, junctions, 8.3, case, `..` after a link) via the real file system; fails closed (returns `{ refused }`) on NUL, `C:x`, device paths, unreadable or looping paths; `null` still means "canonicalises to outside the repo". `guard.mjs` and `lib/shellwrites.mjs` block a refused path |
| 4 records authenticated (G1-2) | `lib/records.mjs`, `precommit.mjs`, `prepush.mjs` | A sign-off is written by its own role, in its own file, with verdict/sha/date; `_required.md`/`_piece.md` and `docs/releases/**` are the Chief of Staff's (Security may add a required role; `records.owner_patterns` per role); no deletes or renames except the Chief of Staff, with `removed-by: chief-of-staff, reason: ...` in the message (checked at push); checked again at push over the first-parent commits, merges included (`--cc`); `completeSignoffs` skips and names a file whose name and `role:` differ. Switch: `records_check` |
| 5 false blocks | `lib/shellblank.mjs`, `guard.mjs`, `policy.json` | `deny_all` patterns run per simple command with quotes and here-document bodies blanked (not on interpreters, `$'..'`, uncertain commands, or patterns marked `"whole": true`); the hook-skip patterns left `deny_all` for `legacy_deny_all` (used when the tokenizer is unsure or ANSI-C quoting appears) |
| 6 smaller (G1-4, G1-5) | `shellrules.mjs`, `policy.mjs`, `bootstrap.mjs`, `scripts/gate.mjs` | A dynamic push target and a variable as an environment-variable name are refused; the role is read from `<git dir>/bootstrap-role` first (written by `bootstrap role`; a mismatch with `BOOTSTRAP_ROLE` is printed, the file wins; it sits outside the working files, but a role with a general file tool could still write it: a seatbelt, not proof); a protected folder, or the folder above one, is a protected write (`rm -rf .githooks`); the gate gains a "git hooks wired" check (needs `core.hooksPath=.githooks` and the hook files) |

Landing (Chief of Staff): copy the files above, plus `lib/records.mjs`, `lib/shellgit.mjs` and `lib/shellblank.mjs`, to the live `.bootstrap/` and `.githooks/`; the staged `policy.json` is the live one plus `records_check`, `records.owner_patterns` and the moved patterns, so `diff` first. Then each `bootstrap role <id>` must be run once per worktree to write the role file (until then the environment and `session.json` still work).
Known gaps (not closed here): a command word that is itself a variable (`$G release create`) cannot be read; `git config` through a script the role writes first is caught only by the hooks at commit and push; the guard still trusts the role it is given.
