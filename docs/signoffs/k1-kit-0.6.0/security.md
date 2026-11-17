---
piece: k1-kit-0.6.0
role: security
sha: 4a0fa01
verdict: PASS
date: 2026-11-17
---

4a0fa01 verified: plugin 0.6.0 guard against the staged policy allows everyday commands and refuses a forced push, push to main, hard reset and ssh; a same-repo session worktree keeps its own role (builder refused on main); checklist 27/27 on my machine; all my attack lists unchanged (no regression). The worktree-escape findings K2-1 (policy-less or planted worktree is not policed), K2-2 (pre-push exits 0 with no policy), K2-3 (main checkout files unprotected from a session worktree) are older than K-1 and identical on the v0.1.7 guard; they are reported to the Chief of Staff and are not closed by K-1. Review document held until the guard restore (Write was refused).
