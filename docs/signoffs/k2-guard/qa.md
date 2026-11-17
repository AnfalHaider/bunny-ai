---
piece: k2-guard
role: qa
sha: bec112e
verdict: PASS
date: 2026-11-17
---

K-2 at bec112e (supersedes ec605fd), KIT_NEXT=1, invented repos only. Kit tests 43/43 (K-2, K-1, landing); guard suites 149/149 twice; my 29 everyday cases 29/29; my 24 extra cases 21/24: the two known diffs (a note quoting the text of a forced push is still blocked; a commit trailer is allowed by the guard, the commit-msg hook refuses it) plus one new by design: QA can no longer run git worktree add (K2-3), so scratch worktrees need the Chief or Release Ops. Plugin 0.6.0 guard vs staged policy: 26/29 and 16/24, unchanged from 4a0fa01 (misses are blocks it never makes plus its two known false blocks); every everyday command allowed. K1-5 deadline: guard answers in about 6.2 s and refuses fail closed, idle and under load 8 busy loops: 21000, 2001 and 64 KB+1 refused unread in under 1 s; 1999 parts and 12 KB note allowed under 1 s; pushes allowed up to about 30 parts (3.7 s), 60 or more refused at the deadline (6.4 s), 1999 pushes 6.5 s instead of 313 s. Not run: real Electron or real hooks in a live session, only the invented-repo hook.
