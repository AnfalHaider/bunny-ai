# K-1 / K-2 guard review (Security, 2026-11-17)

Pieces: `k1-kit-0.6.0` (4a0fa01) and `k2-guard` (1d3a77c, replaces ec605fd and bec112e).

## K-1 at 4a0fa01
The kit-0.6.0 weakness list (A1-A3, B1-B12) is in `2026-11-17-k1-kit-0.6.0-weakenings.md`. The worktree escape found at 4a0fa01: a worktree of the same repository kept its own role and policy, so an old-history worktree (no policy) or a planted git dir (`.git` file with its own `commondir`, `bootstrap-role` and permissive policy) let a builder push main, redirect into AGENTS.md and write the project's policy (K2-1 to K2-3). Probes: `k2-probe/k1wt2.mjs`, `k1wt3.mjs`.

## K-2
- K2-1 to K2-3: the project policy now judges every folder that is not a registered worktree of it (role `unassigned`); the hooks run from the main checkout and fail closed. Verified at 2feee7d, ec605fd, bec112e, 1d3a77c.
- K2-4 (found at 2feee7d): a repository outside the project, or a planted `.git` whose `commondir` pointed at one, was judged by its own permissive policy. Fixed: when `CLAUDE_PROJECT_DIR` names a project with a policy, that policy judges every folder.
- `.git` internals: `refs/heads/main`, `HEAD`, `packed-refs`, `info/attributes`, `worktrees/*` were writable; now refused. bec112e: Release Ops may write only ref storage.
- K1-5: every git spawn honours the 6 s deadline; a git that cannot answer is a refusal, not a pass (1d3a77c). 60 and 200 chained `git push --all` exit 2 in under 3 s; chained `git push origin f` is cut at 6.2 s and refused.
- W5-1d: `git credential`, `gh auth token`, `gh auth status -t/--show-token` refused for every role; pre-push refuses `refs/notes|for|releases/` and the live branch in another case for non-live roles.

## Accepted (not fixed)
- `git init` (nested or elsewhere) and `git worktree repair|prune|move|lock` are allowed; `gitdir`/`commondir` writes stay refused, and the project judges the result.
- With `CLAUDE_PROJECT_DIR` unset, a hook running inside a nested repo judges by that repo's policy; the host always sets it.
- Interpreter one-liners, hard links and similar tricks (13 shell, 13 link, 7 round2, 4 dev2 entries in my lists) are the accepted seatbelt class; the backstops are pre-commit and pre-push by role.

## Method note
My first K1-5 timing used `test/guard-helpers.js` without `KIT_NEXT=1`, so it measured the repository's 0.6.0 guard. I stamped FAIL on that at ec605fd and bec112e; both were wrong and are superseded by the PASS at 1d3a77c.
