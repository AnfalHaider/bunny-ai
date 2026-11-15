---
title: Upstream report for the bootstrap-environment plugin
author: tech-lead
date: 2026-11-16
for: the owner, via the Chief of Staff (the plugin source is AnfalHaider/Bootstrap-environment, local checkout D:\Projects\Bootstrap-environment)
status: report only. Nothing was written to the plugin or to its checkout. Line numbers are from the installed copy, version 0.4.0, in the plugin cache.
related: docs/plans/guard-gaps-spec.md (the repo-side fixes, for Builder)
---

# What the plugin gets wrong, and the fix, item by item

The repo guard (`.bootstrap/bin`) and the plugin copy share their logic, so each item below also exists in the repo. Builder fixes the repo copy from `docs/plans/guard-gaps-spec.md`; this document is what to carry to the plugin's own repository so the next install does not bring the faults back. File names are relative to `bin/` in the plugin.

## E. The record-folder check reads the whole command string (`guard.mjs`)

**What.** `WRITE_OPS` (`guard.mjs:49`) is one regular expression (`>>?`, `tee`, `cp`, `mv`, `rm`, `sed -i`, `Set-Content`, `Add-Content`, `Out-File`, `New-Item`, `Copy-Item`, `Move-Item`, `Remove-Item`, `del`, `ln`, `git checkout|restore`) tested against the **entire** command (`guard.mjs:80`). When it matches anywhere, every `docs/signoffs/...` or `docs/releases/...` path **anywhere in the same string** is judged as a write target (`guard.mjs:81-84`) and refused for a role that may not write there. Related: the sign-off CLI rule (`guard.mjs:72`) is `/bootstrap(?:\.mjs)?\s+(signoff|require|piece|approve|release)\b(.*)$/m`, which takes the **rest of the line** as the command's options, so `--role` in a later command chained with `;` is attributed to the sign-off.

**Reproduced, 2026-11-16.** A read-only `ls` of a sign-off folder, chained after a `signoff` command that carried `2>&1`, was refused with "only the Chief of Staff manages sign-off folders." A sign-off note containing an arrow, a comparison sign, or the words `cp` or `rm`, plus a folder path anywhere in the command, is refused the same way.

**Fix.** Do not scan the string. Tokenize it once (quote-aware, see "Shared tokenizer" below) into simple commands (split on `;`, `&&`, `||`, `|`, newline). For each simple command:
1. It is a *write* only if its **command word** is a write command, or it has an **unquoted** redirection that is not `2>&1`, `>/dev/null`, `2>/dev/null` or `>NUL`.
2. A record-folder path counts only when it is a **target** of that write: the redirect target, the last argument of `cp`/`mv`, the arguments of `rm`, `tee`, `Set-Content`, `Out-File` and the like. Never an argument of `ls`, `cat`, `git add`, `git status`, and never text inside quotes.
3. The bootstrap CLI rule parses the argv of **its own** simple command (`--role`, `--verdict`, `--sha`, `--note`), not the rest of the line.
4. Quoted text is data and is never scanned for operators.
5. Fail closed on a write whose target cannot be resolved (`> $x`), fail open on read-only commands.

**Test cases (plugin `tests/`).**
- Allow: the `signoff` command with a plain note; the same with `2>&1 | tail -5`; chained with `; ls docs/signoffs/b-1` and with `&& git status`; a note containing an arrow, `cp` and `rm` as words; `git add docs/signoffs/b-1/tech-lead.md`; `cat docs/releases/x.md`.
- Deny: `echo x > docs/signoffs/b-1/qa.md`; `cp x.md docs/signoffs/b-1/qa.md`; `tee docs/releases/r.md`; `Set-Content docs/signoffs/b-1/qa.md x`; `sed -i s/a/b/ docs/signoffs/b-1/qa.md`; `signoff ... --role qa` run as another role; `signoff ...; echo --role qa` must not be attributed to the sign-off.
- Malformed: unbalanced quote; empty command; a 1 MB command (inside the hook's 10 s limit); a note with an embedded newline; a trailing `;`.

## C. The commit hook-skip rule is a regular expression over the raw command (`lib/policy.mjs`, `DEFAULT_POLICY.deny_all`)

**What.** The plugin's default rules (`lib/policy.mjs:16-22`) are `--no-verify\b`, `git config ... core.hooksPath`, and a few others, matched against the whole command with `new RegExp(pat).test(command)` (`guard.mjs`, the shell branch). The repo's own `policy.json` carries a longer set added in commit 29e34fb (abbreviated flag `-n`, `--no-ve...`, `-c core.hooksPath`, `GIT_CONFIG_*`, and a bare `core.hooksPath`). Two consequences:
1. **False blocks:** any command that merely *contains* the text, such as a shell command that writes this very paragraph into a file, is refused. This happened twice while writing the specs (the long hook-skip flag, and a sentence naming `core.hooksPath`).
2. **Misses:** a regex cannot know where `commit` sits in `git -C dir -c k=v commit ...`, or what is inside quotes, so any shape the pattern list does not foresee gets through (a flag bundled with others, an alias, a here-document).

**Fix.** Use the shared tokenizer. Find `git`, skip git's global options with their arguments (`-C <dir>`, `-c <k=v>`, `--git-dir`, `--work-tree`, `--no-pager`, `--exec-path`, ...), take the next word as the subcommand. For `commit`, `push`, `merge`, `rebase`, `am`, `cherry-pick`: reject the short flag `-n` (alone or inside a bundle such as `-an`), the long skip flag and every unambiguous prefix of it, and any `-c core.hooksPath=...` or `GIT_CONFIG_*` set before the subcommand. Quoted text (a commit message that mentions the flag) is allowed.

**Test cases.** Allow: `git commit -m "fix -n handling"`; `git commit -am x`; `git -C "a b" commit -m x`; a file write whose text mentions the flag (through the Write tool) and a shell command that only *prints* it inside quotes. Deny: `git commit -n`; `git commit -an -m x`; the long skip flag in full and abbreviated; `git -c core.hooksPath=x commit`; `git -C d commit` with the skip flag; `GIT_CONFIG_COUNT=1 git commit`. Malformed: unbalanced quote; empty command; a very long command.

## A3. `git -c core.hooksPath=<dir> <subcommand>` skips the hooks

**What.** The default rule (`lib/policy.mjs:19`) only matches `git config ... core.hooksPath`. A per-command override, `git -c core.hooksPath=/dev/null push`, skips the pre-push hook and is not caught by it.

**Status.** The repo's `policy.json` already covers this since 29e34fb (a pattern for `-c core.hooksPath` and a bare `core.hooksPath` pattern). **The plugin's default policy still lacks it**, so a fresh project gets the gap. Fix: add the tokenizer rule above (C) to the plugin's guard, and the same patterns to `DEFAULT_POLICY.deny_all` until the tokenizer lands. Test: the deny cases listed under C.

## D. `bootstrap role` re-enables plugins the project turned off (`bootstrap.mjs:129-137`)

**What.** The narrowing step reads the project's plugin list from `.claude/settings.json` (`installed`, line 131) but then sets `s.enabledPlugins[id2] = name === 'bootstrap-environment' || kit.some((k) => globToRegex(k).test(name))` (line 137). A kit entry such as `*-lsp` matches every plugin whose name ends in `-lsp`, including `php-lsp` and `csharp-lsp`, which the project sets to `false`. The role's local settings then switch them **on**.

**Fix.** Narrow only: `enabled = projectValue === true && kitMatches`. Never write `true` for a plugin the project has false or has not listed. Keep the bootstrap plugin itself on.

**Test.** A project with `a-lsp: true`, `b-lsp: false`, `c: true`; a role whose kit is `*-lsp`: result `a-lsp` on, `b-lsp` off, `c` off. A role with an empty kit: everything off except the bootstrap plugin. A plugin the project does not list: absent from the output.

## F. A code commit counts as signed when it is an ancestor of **any** complete sign-off (`prepush.mjs`)

**What.** Coverage is decided by ancestry only. In the installed plugin it is `git merge-base --is-ancestor <commit> <sha>` at `prepush.mjs:85` (inside `completeSignoffs`, per-lane flow) and again at `prepush.mjs:170-171` (the unsigned-commit test). The repo's older copy has the same at `.bootstrap/bin/prepush.mjs:120-121`. So when branch work is stacked, say D1 (`2cfeec5`) on top of S-1 (`ca01243`), a complete set of sign-offs for D1 at `2cfeec5` marks **every ancestor** covered, including S-1's commits, even if S-1 never got its own review (for example Security's).

**Fix.** A piece's sign-offs cover only the commits **that piece names or ranges**, not every ancestor:
1. `_piece.md` gains `commits: [<sha>, ...]` or `base: <sha>` (the previous piece's sha). Covered commits = those in `base..<signed sha>` (or the listed ones).
2. If `base` is absent, default to the nearest ancestor commit that is **itself covered by a complete sign-off set** (so stacking works without extra input) and otherwise to the branch's merge-base with the remote branch. A commit that no piece covers is unsigned.
3. The error message names the uncovered commits and the piece that stopped short of them.
4. `bootstrap piece <id>` writes `base` when the Chief of Staff creates the piece.

**Test cases.**
- Two stacked pieces, A at `a1`, B at `b1` (`b1` descends from `a1`): sign-offs complete for B only → pushing `a1` and `b1` is refused for `a1`; sign-offs complete for A and B → accepted.
- Piece B with `base: a1`: covers only `a1..b1`; with `base` missing, `a1` is covered only if A has a complete set.
- A merge commit in the range; a squash; a commit that appears in no piece; a `_piece.md` that names a commit not in the branch (error, not a silent pass).
- Legacy: a project with no `base` keeps today's behaviour behind a flag for one release, with a warning.

## Shared tokenizer (the one piece of new code that E, C and A3 all need)

A single function, `splitCommand(text)` in a new `lib/shellparse.mjs`, returning `[{ words: [...], redirects: [{op, target}], raw }]`. It must handle single and double quotes, backslash escapes, here-documents and here-strings (their bodies are data), PowerShell backtick escapes, `&&`, `||`, `;`, `|`, `&`, newlines, `$(...)` and backticks (treated as opaque: not parsed, and a write found to depend on one fails closed). About 80 lines with its own tests, written and passing before E, C or A3 use it. Tests: round-trip a corpus of 40 real commands taken from session logs; quotes containing every operator; unbalanced input; a 1 MB input in under a second.

## Order for the plugin repository

1. Tokenizer and its tests.
2. E and C on it (they are the two false-block sources seen in daily use).
3. A3 patterns in `DEFAULT_POLICY` and in the tokenizer rule.
4. D (small, independent).
5. F (needs a `_piece.md` schema change and a one-release compatibility flag; the owner decides whether to hold stacked work until it lands, or to rely on the Chief of Staff naming each piece's base by hand in the meantime).

Until then, in this project: A3 is covered by the repo's own `policy.json` (29e34fb); E and C remain false-block sources, worked around by editing text files with the Write and Edit tools; D is worked around by re-checking the enabled plugin list after `bootstrap role`; F is real, so **a stacked branch must have a complete sign-off set per piece, and the Chief of Staff should confirm S-1's sign-offs (including Security) exist before relying on D1's.**
