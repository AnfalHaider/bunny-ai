---
piece: k2-guard
role: tech-lead
sha: ec605fd
verdict: PASS
date: 2026-11-17
---

Design: one resolveContext (project from git's common dir; only folders git lists as worktrees use their own role, all else 'unassigned'). Hooks run the main checkout's checks and fail closed; K1-5 deadline with 8 s child. Tests 43/43 (k2, k1, landing) and 149/149 guard suites with KIT_NEXT=1; e2e not run by me. My probe from a registered builder worktree: writes to main's hooks, guard, policy, AGENTS refused, worktree add refused, own src allowed. Follow-up (low): git -C main commit is allowed and is judged by main's role in the hook (can commit the CoS's staged work, adds no content). Lands with K-1.
