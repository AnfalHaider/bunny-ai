---
piece: w5-1-guard
role: tech-lead
sha: d3ee1cf
verdict: PASS
date: 2026-11-16
---

Guard commits 8df7583..d3ee1cf read against my spec. Unit tests on a scratch checkout: guard-016 and guard-next suites 124 pass, 0 fail, also with GUARD_STAGED=1. My probes of the staged guard as a hook, 117 commands as builder and release-ops: all as expected except six, none of them in my spec: pushing a tag, pushing all tags, adding or changing a remote url, pushing to a bare URL, and a forced move of the main branch label (LOW to MEDIUM, file as G1-6: refuse remote url changes and pushes to non-origin targets for non-live roles); the rare plumbing command checkout-index is refused as unknown (add it to the builtin list). Landing: the three hook wrappers are byte-identical to the live ones, so nothing shared changes and a stale worktree keeps its own old scripts until it merges main; that is what broke G-1. The role file is per worktree (absolute git dir), the environment and session.json still work until it exists, and the file wins afterwards, so rerun bootstrap role when a worktree changes role. Run bootstrap role from the main checkout copy with the worktree as cwd, because a stale bootstrap.mjs does not write the file. IMPORTANT: d3ee1cf also contains lane A at 3af63d7, which I failed (regex and glob hangs); land the guard by copying scripts/guard-next, scripts/gate.mjs and the guard tests, or wait for the lane A fix, not by merging d3ee1cf as is. e2e not run by me.
