---
piece: k2-guard
role: tech-lead
sha: bec112e
verdict: PASS
date: 2026-11-17
---

Supersedes ec605fd. Delta is 13 lines: Release Ops writes under .git limited to refs/heads, refs/tags, packed-refs, ORIG_HEAD, FETCH_HEAD; commondir, gitdir, bootstrap-role, config, hooks, worktrees/* refused for all but the Chief of Staff (paths are canonicalised so .. does not get round it; a branch named hooks/x is refused too, harmless). Tests k2+k1+landing 42/43 in the combined run: the one failure is the K1 timing check (answered in 1122 ms, limit 1000) under load; it passes 3 of 3 alone. e2e not run by me.
