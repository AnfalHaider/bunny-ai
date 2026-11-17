---
piece: k2-guard
role: qa
sha: 1d3a77c
verdict: PASS
date: 2026-11-17
---

K-2 at 1d3a77c (supersedes bec112e), KIT_NEXT=1, invented repos only. Kit tests 45/45 (K-2, K-1, landing); guard suites 149/149 twice; my 29 everyday cases 29/29; my 24 extra cases 21/24 = the two known diffs (note quoting forced-push words is blocked; commit trailer allowed by the guard, the commit-msg hook refuses it) plus the by-design K2-3 change that QA cannot run git worktree add. Plugin 0.6.0 guard vs staged policy 26/29 and 16/24, unchanged. Timings of the real hook, idle / 8 busy loops: 21000, 2001 parts and 64 KB+1 refused unread 0.5 / 0.8 s; 1999 parts and 12 KB note allowed 0.5 / 0.9 s; 40, 50, 60 chained push-all refused by rule in 0.5 / 0.8 s (not a timing case); 30, 40, 50 chained plain pushes allowed 3.0, 3.4, 4.5 s idle and 3.8, 4.8, 6.0 s loaded (50 under load is close to the 6.2 s deadline); 150, 300, 1999 pushes refused at the 6.2 s deadline (6.4 s loaded), was 313 s; everyday commands 0.5 s idle, 0.7 s loaded. Not run: a live session with the real hooks or Electron.
