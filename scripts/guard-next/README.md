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
2. Copy every file in the table to its target in one commit as chief-of-staff. **LF endings** (the hooks are shell scripts);
   `git config core.autocrlf` is `true` on this machine, so add `.githooks/* text eol=lf` to `.gitattributes` or the checked-out
   `pre-commit` gets CRLF.
3. `git update-index --chmod=+x .githooks/pre-commit`. `bootstrap init` should also write `.githooks/pre-commit`
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
- **The "require" sub-command** (which roles must sign a piece) can be run by any role today, as before. Narrowing it to the Chief of Staff would stop a role weakening a piece's sign-off list, but Tech Lead's own workflow writes `_required.md`. The plugin guard already restricts it to chief-of-staff and security. Decision for Tech Lead and the Chief of Staff.
- **Windows names.** 8.3 short names are resolved only when the file already exists; junctions and symlinks are not
  followed (spec item B2, not built).

## Report upstream (plugin guard, outside this repo; not edited here)

The bootstrap-environment plugin's own guard (plugin cache, `0.4.0/bin/guard.mjs`) has the same shell false blocks: its write
regex is tested against the whole command string, any `docs/signoffs/...` path in the string is then judged a write target,
and its sign-off CLI rule reads the rest of the line as the sign-off's options. The tokenizer and the corrected checks in
`lib/shellparse.mjs`, `lib/shellrules.mjs` and `lib/shellwrites.mjs` are written to be lifted into it. Items **C**, **A3**
and **E** should be reported to the plugin's source; the owner or Chief of Staff names it.
