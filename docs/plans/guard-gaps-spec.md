---
title: Guard gaps spec — shell writes and cross-drive paths
author: tech-lead
date: 2026-11-16
risk: HIGH (security control; `.bootstrap/**` is protected toolkit config)
status: proposal — nobody builds until the owner types the go (AGENTS.md O4, O10)
---

# Guard gaps: spec and recommendation

Subject: `.bootstrap/bin/guard.mjs` and `.bootstrap/bin/lib/policy.mjs`, as of 06b06b4 (`initial-import`).
Both gaps were **reproduced read-only** on 2026-11-16 by calling `decide()` and `toRepoPath()` from a throwaway script kept outside the repo (role `tech-lead`, repo on `D:`). Nothing in the repo was changed.

## Gap A — shell commands are not checked against `write_globs` or `protected_globs`

**Where.** `guard.mjs:51-65` (shell branch) returns `{allow:true}` after only the `deny_all` / `destructive_commands` regexes and the `git push` live-branch check. The scope checks (`protected_globs`, `write_globs`) live only in the file-tool branch, `guard.mjs:67-77`. The hook matcher in `.claude/settings.json` sends `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit` to the guard, so shell commands do arrive; they are simply not scoped.

**Reproduced.** As `tech-lead` (writes only `docs/**`, `*.md`): `Bash` `sed -i s/a/b/ src/app.js` → allow; `Bash` `echo hi > src/app.js` → allow. The same write through `Write` is blocked.

**Why it matters beyond role scope.** `protected_globs` (`.bootstrap/**`, `.githooks/**`, `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`) are bypassed the same way. A shell write to the session-role file changes the role; a write to `.githooks/pre-push` removes the push check. Role assignment and the pre-push hook are only as strong as the agent's cooperation.

(Separately, the bootstrap plugin runs a second hook that blocks some such commands by string match. It is not part of this repo's guard, and it false-blocked the first attempt to write this very document through a shell heredoc, because the prose mentioned the session-role file. That is a live example of the A2 false-block risk below.)

**No sound fix at the hook.** A command string cannot be reliably parsed for its write targets: `sed -i`, `>`/`>>`, `tee`, `cp`/`mv`/`rm`, `git checkout -- f`, `git apply`, PowerShell `Set-Content`/`Out-File`/`Remove-Item`, `node -e`/`python -c` (any file API), `npm run <script that writes>`, or a script the agent just wrote. A regex list can only catch the careless cases. So: two layers, one authoritative, one best-effort.

### A1 (authoritative, recommended first): check changed paths at commit and push

Git sees what actually changed, whatever tool changed it.

- New `.githooks/pre-commit`: for the **staged** paths (`git diff --cached --name-only --diff-filter=ACMRD -z`, with renames reported as both sides), apply the same two tests as the file-tool branch: `protected_globs` (unless role is `chief-of-staff`), then `write_globs` if the role declares any.
- Backstop in `prepush.mjs` `checkPush`: the same test over the **non-merge** commits in the pushed range, for the pusher's role (`currentRole`). Skip merge commits and roles without `write_globs`.
- Factor the test into one exported function in `policy.mjs` (e.g. `scopeViolation(rel, policy, brief, role)`) used by `guard.mjs`, the pre-commit hook and `prepush.mjs`, so the rule is stated once.
- Size: one new function (~12 lines), one new ~15-line hook file, one call in `checkPush`.

**Tests (A1).** Temp git repo, invented profile, fake role files.
- Allow: `tech-lead` stages `docs/x.md` and a root `README.md` → exit 0. A role without `write_globs` stages any non-protected file → exit 0. `chief-of-staff` stages `AGENTS.md` → exit 0.
- Deny: `tech-lead` stages `src/a.js` → exit 1 naming the file. Any non-CoS role stages `.bootstrap/policy.json`, `.githooks/pre-push` or `AGENTS.md` → exit 1. Deleting a protected file → exit 1. Rename `docs/a.md` → `src/a.md`: check both sides, deny.
- Malformed: role file missing or unparsable → role `unassigned`, no scope applies (as today) but protected paths still deny. Paths with spaces and non-ASCII (`-z` handling). Empty commit → exit 0. `write_globs: []` → no scope (today's behaviour).

**False-block risk (A1).** Release Ops or the Chief of Staff pushing a merge of other roles' work: handled by skipping merge commits at push time, and by checking only the committer's own staged files at commit time. Cherry-picks of another role's commits are checked against the picker's role. Each `.bootstrap/roles/*.md` must declare the `write_globs` it needs before this ships (confirm, role by role; today only some do). The hook must fail open with a loud message on an internal error and fail closed only on a definite violation; a hook that blocks every commit on a bug is worse than the gap.

### A2 (best-effort, second): shell write-target heuristic in `guard.mjs`

- In the shell branch, extract candidate targets only from a short, explicit pattern list: redirections (`>`, `>>`, `2>`), `tee [-a]`, `sed -i`, `cp`/`mv`/`rm`/`touch`/`mkdir` path arguments, `Set-Content`/`Add-Content`/`Out-File`/`Remove-Item`/`Move-Item`/`Copy-Item`/`New-Item` paths, `git checkout|restore -- <paths>`.
- Run each candidate through `toRepoPath` plus the shared scope test. Candidates containing `$`, backticks, `*` or `%` cannot be resolved: do not block on those, except when the command also names a protected glob literally in a write-looking position.
- State in the code and the docs that this layer is a seatbelt, not a wall. `node -e`, `python -c` and generated scripts pass it; A1 catches them at commit.

**Tests (A2).** Allow: `echo x > docs/a.md`; `git status`; `cat src/a.js`; a search for the character `>` in quotes; `npm test`; a heredoc whose body contains `>`; `> NUL` and `/dev/null`; `2>&1`. Deny (as `tech-lead`): `sed -i s/a/b/ src/app.js`; `echo hi > src/app.js`; `tee` to a `.bootstrap/` file; `Set-Content -Path .githooks/pre-push -Value x`; `cp x.md .bootstrap/policy.json`. Malformed: unbalanced quotes, empty command, a 1 MB command (must finish well inside the 10 s hook timeout).

**False-block risk (A2): the highest here.** Quotes, here-strings, and `>` inside regexes, JSON or comparisons are the classic false positives, and a wrongly blocked shell stalls a session. Keep the pattern list short, ignore text inside quotes unless it is the target token, and ship it behind a `policy.json` switch (default on) so the Chief of Staff can turn it off with one edit while it is tuned.

### Related gaps seen while reading (board rows, not part of this go)

- **A3.** The deny regex `\bgit\s+config\b.*\bcore\.hooksPath\b` misses `git -c core.hooksPath=<dir> push`, which skips the pre-push hook. Add a deny pattern for `-c core.hooksPath` and a test. A1 does not help (it runs inside the hook being skipped).
- **A4.** The settings matcher covers shell and file tools only. Writes by other tools (MCP servers, a subagent started with the Agent tool) are not hooked; A1 is the only layer that sees them.
- **A5.** `currentRole` honours `BOOTSTRAP_ROLE` from the environment of the guard process. The plugin hook blocks setting it in a command, which is the right control, with the same string-match limits as A2.

## Gap B — cross-drive paths on Windows (`toRepoPath`)

**Where.** `policy.mjs:89-92`, `toRepoPath`: `relative(root, abs)` between two drives returns the absolute target (`C:\Users\...`), not a `..` path. After backslash normalisation it is `C:/Users/...`. `guard.mjs:69` then tests `rel.startsWith('..')` to mean "outside the project: not ours to police", which is false for this value, so the file falls through to the scope test.

**Reproduced** (repo `D:/Projects/.../tech-lead-86cf31`, role `tech-lead`):

| File | `toRepoPath` | Guard result |
|---|---|---|
| `C:\Users\<user>\x.txt` | `C:/Users/<user>/x.txt` | **block** ("outside that") — the false block |
| `D:\other\x.txt` | `../../../../../../other/x.txt` | allow (correct) |
| `\\srv\sh\a.md` | `//srv/sh/a.md` | same shape as `C:`; not run through `decide()` |
| `..foo.md` (a file inside the repo) | `..foo.md` | `startsWith('..')` is true → treated as outside → **skips protected and scope checks** |

Direction of harm. For a scoped role, a write on another drive is blocked although the rule says it is not policed (the reported symptom). The `..foo.md` case is the reverse and matters more for a security control: an in-repo file whose name begins with `..` skips every check.

**Smallest fix** (one function plus one call site):

1. In `policy.mjs`, make `toRepoPath` return `null` when the target is outside the root: `rel === '..' || rel.startsWith('../') || isAbsolute(rel)`, after `\`→`/` normalisation (UNC `//host/...` is caught by `isAbsolute` on Windows).
2. In `guard.mjs:68-69`, replace `if (rel.startsWith('..')) return { allow: true }` with `if (rel === null) return { allow: true }`.
3. `toRepoPath` has one caller (`guard.mjs:68`; `grep` before building to confirm).

**Tests (B).** Pure-function tests on `toRepoPath` plus `decide()` with a fake root; cross-drive cases run on Windows only.
- Allow, in-repo: `docs/a.md` relative, in-repo absolute, mixed slashes and `./`, a different-case drive letter for the same root.
- Outside → `null` → guard allows: `C:\Users\x\a.txt`, `D:\other\x.txt`, `..\x`, `..`, `\\srv\sh\a.md`, a sibling folder whose name starts with the repo's name.
- In-repo, must not be mistaken for outside: `..foo.md`, `docs\..bar.md`.
- Deny (still policed): `.bootstrap\policy.json` with different casing, and `docs\..\.bootstrap\policy.json` (normalised) → protected block.
- Malformed: empty string, `NUL`, a path with a null byte, a path over 260 chars, a relative path with `cwd` undefined.

**False-block risk (B).** Low. The change makes the guard allow outside files and stop mis-reading `..foo.md`. Residual: junctions, symlinks and 8.3 short names that point into the repo are not resolved by `path.relative`; fixing that needs `realpathSync` on the target's nearest existing parent. Out of scope for the smallest fix; list as B2 if wanted.

## Recommendation

1. **Build B first.** Tiny, low risk, closes a real bypass (`..foo.md`) and the cross-drive false block.
2. **Then A1** (pre-commit and pre-push scope check, one shared function). This is what makes role limits real.
3. **A2 only after A1**, behind a switch, tuned on invented sessions; skip it if A1 proves enough.
4. File A3–A5 as their own board rows.

Both files are `protected_globs`, so the Chief of Staff makes the edit (or Builder under a CoS-recorded go). Tech Lead reviews the diff and the tests and does not write the change. Before sign-off: `node scripts/gate.mjs`, the new guard tests, and a replay of the repro tables above.

## Addendum 2026-11-16 (from the Chief of Staff; for the owner's go with the rest)

- **C. The commit rule is a regex over the raw command.** `.bootstrap/policy.json` matches the commit hook-skip rule with a regular expression over the whole command string; 29e34fb widened it. A regex cannot know where `commit` sits in `git -C dir -c k=v commit -n`, or what is inside quotes. Proper fix: a quote-aware tokenizer in `guard.mjs` that splits the command into words, finds the `commit` subcommand after git's global options (`-C`, `-c`, `--git-dir`, `--work-tree`, `--no-pager`, ...), and rejects the short flag `-n`, the long hook-skip flag, short-option bundles containing `n` (for example `-an`), and `-c core.hooksPath=...` anywhere before the subcommand. Reuse it for A3 (`git -c core.hooksPath=... push`) and for the push-target parse that `pushTargets` does today with `split(/\s+/)`. Tests: allow `git commit -m "fix -n handling"` (the flag is inside a quoted message), `git commit -am x`, `git -C "a b" commit -m x`; deny `git commit -n`, `git commit -an -m x`, the long hook-skip flag, `git -c core.hooksPath=x commit`, `git -C d commit` with the long flag; malformed: unbalanced quote, empty command, a very long command. False-block risk: medium, because quoting is where this goes wrong, so it needs the same policy switch as A2. **Live example, 2026-11-16:** a shell command that only *wrote this paragraph* into a file was refused because the paragraph contains the long flag's text; the file had to be edited with the Edit tool instead.
- **D. `bootstrap role` kit narrowing re-enabled plugins the project turns off.** The role kit entry `*-lsp` matched `php-lsp` and `csharp-lsp`, which `.claude/settings.json` sets to false, and narrowing switched them back on in the worktree's local settings. Fix: when narrowing, intersect the kit with what the project settings enable, and never widen. Test with a project that disables two LSP plugins and a role whose kit is `*-lsp`.
- **E. The plugin guard's record check reads the whole command string.** Reproduced on 2026-11-16 in `~/.claude/plugins/cache/bootstrap-environment/bootstrap-environment/0.4.0/bin/guard.mjs`: `WRITE_OPS` (line 49) is one regular expression (`>>?`, `tee`, `cp`, `mv`, `rm`, `sed -i`, `Set-Content`, `Out-File`, `git checkout|restore`, ...) tested against the entire command, and then (lines 81-84) any `docs/signoffs/...` or `docs/releases/...` path anywhere in the same string is judged as a write target. Two harmless commands show it: (1) my B-1 sign-off attempt carried a stderr redirect `2>&1` and, separately in the same line, a read-only `ls` of the sign-off folder, so the `ls` argument was treated as a write into a record folder and refused with "only the Chief of Staff manages sign-off folders"; (2) a sign-off note that contains an arrow, a comparison sign or a word like `cp`/`rm` makes `WRITE_OPS` match, after which any folder path in the note is refused. Also, the sign-off CLI rule reads `(.*)$` with the multiline flag, so it takes the rest of the line, including a later command chained with `;`, as the sign-off's own options (`--role` in a later command would be attributed to the sign-off).
  - **Fix (shared with C):** one small quote-aware tokenizer, `lib/shellparse.mjs`, that returns simple commands (split on `;`, `&&`, `||`, `|`, newline), each with its words, quotes resolved, and its redirections as separate items. Then: (a) a command is a *write* only if its **command word** is a write command (`cp`, `mv`, `rm`, `tee`, `sed -i`, `Set-Content`, `Out-File`, `New-Item`, `Copy-Item`, `Move-Item`, `Remove-Item`, `git checkout|restore --`) or it has an unquoted redirection that is not `2>&1`, `>/dev/null`, `>NUL`, `2>/dev/null`; (b) a record-folder path counts only when it is a **target** of that write (the redirect target, the last argument of `cp`/`mv`, the arguments of `rm`/`tee`/`Set-Content`), never an argument of `ls`, `cat`, `git add`, `git status`, or text inside quotes; (c) the bootstrap CLI rule parses argv of its own simple command (`--role`, `--verdict`, `--sha`, `--note`), not the rest of the line; (d) quoted text is data and is never scanned for operators.
  - **Where it lives is a decision, not a detail.** This guard is in the plugin cache, outside the repository: a repo commit cannot change it, and a plugin update would replace a local edit. Recommended: put the tokenizer and the corrected checks in the repo guard (`.bootstrap/bin`, tracked, tested in `test/`) and report E, C and A3 to the plugin's source so the cache copy is fixed upstream; until then the plugin hook stays on and is stricter than the repo guard, which is the safe direction. The owner or the Chief of Staff names the plugin's source; I have not found it from here.
  - **Tests (E).** Allow: `node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --sha abc1234 --note "plain words"`; the same with `2>&1 | tail -5`; the same chained with `; ls docs/signoffs/b-1` and with `&& git status`; `--note "a -> b, cp and rm are words here"`; `git add docs/signoffs/b-1/tech-lead.md`; `cat docs/releases/x.md`. Deny: `echo x > docs/signoffs/b-1/qa.md`; `cp x.md docs/signoffs/b-1/qa.md`; `tee docs/releases/r.md`; `Set-Content docs/signoffs/b-1/qa.md x`; `signoff ... --role qa` run by tech-lead; `sed -i s/a/b/ docs/signoffs/b-1/qa.md`. Malformed: unbalanced quote, empty command, a command of 1 MB (inside the hook's 10 s limit), `--note` with an embedded newline, a trailing `;`. False-block risk: the tokenizer must **fail closed on a write it cannot parse** (a redirect to a variable path such as `> $x`, a here-string that is the target of `tee`) but **fail open on read-only commands**; it ships behind a policy switch like A2.

- **F. Sign-off coverage is decided by ancestry alone (about e704ba5, from the Chief of Staff).** `.bootstrap/bin/prepush.mjs:120-121` treats a code commit as signed when it is an ancestor of **any** complete sign-off sha, so a complete set for a stacked piece (D1 on top of S-1) also covers the lower piece's commits. Fix: a piece's sign-offs cover only the commits it names or ranges (`commits:` or `base:` in `_piece.md`; default the base to the nearest ancestor that a complete set already covers, else the merge-base with the remote branch); the error names the uncovered commits. Tests: two stacked pieces with a complete set for the upper one only (lower commit refused); complete sets for both (accepted); a `base` that is not in the branch (error); a merge commit and a squash in the range. The plugin has the same logic (`prepush.mjs:85` and `:170-171`); the upstream report is `docs/plans/upstream-bootstrap-notes.md`.

## Consolidated scope of the owner's go ("yes fix the guards, but also ensure all these issues are sorted. and fixed properly")

| Item | What | Order | Where the code goes |
|---|---|---|---|
| B | `toRepoPath` returns `null` outside the repo; fixes the cross-drive block and the `..foo.md` bypass | 1 | `lib/policy.mjs`, `guard.mjs` |
| A1 | pre-commit and pre-push scope check on changed paths, one shared function | 2 | `lib/policy.mjs`, `.githooks/pre-commit`, `prepush.mjs` |
| Tokenizer | `lib/shellparse.mjs`, tested alone first | 3 | new file under `.bootstrap/bin/lib` |
| C, A3 | commit hook-skip rule and `-c core.hooksPath` rule use the tokenizer | 4 | `guard.mjs`, `policy.json` |
| A2 | shell write-target check using the tokenizer (behind a switch) | 5 | `guard.mjs` |
| E | record-folder check uses the tokenizer | 5 | repo guard now; upstream to the plugin |
| A4, A5 | notes on other tools and the role environment variable: documented limits plus the A1 backstop | with A1 | docs, A1 |
| D | kit narrowing never widens | independent | `bootstrap role` code (plugin or `scripts/`: confirm where) |

Each row ends only with its own tests green, `node scripts/gate.mjs` output pasted, and the replay of the reproduction tables in this document.
