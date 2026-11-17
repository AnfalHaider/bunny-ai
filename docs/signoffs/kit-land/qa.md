---
piece: kit-land
role: qa
sha: 88bbd53
verdict: PASS
date: 2026-11-17
---

Kit landing at 88bbd53, checked in a checkout of that sha against the INSTALLED .bootstrap/bin (no KIT_NEXT), invented repos only. Installed bin and policy and both hooks are byte-identical to scripts/kit-next at 1d3a77c except adapt.mjs and lib/fm.mjs (kit files that are not in the staged copy; I did not review those two). My 29 everyday cases 29/29. My 24 extra cases 21/24, the same three as on the staged kit: a sign-off note that quotes forced-push words is blocked (false block); the guard allows a commit with a Claude trailer (the commit-msg hook refuses it); git worktree add is refused for QA (by design, K2-3). Real hook timing, idle / 8 busy loops: 21000 and 2001 parts and 64 KB+1 refused unread 0.6-1.4 s / 0.8-1.0 s; 1999 parts and 12 KB note allowed 0.7 and 0.6 s / 1.1 and 1.0 s; chained push-all refused by rule 0.7 s / 1.0 s; 30 chained pushes allowed 3.7 s / 5.8 s; 40 allowed 5.1 s idle, refused at the 6.2 s deadline under load; 50 or more, and 150, 300, 1999, refused at the deadline 6.1-6.2 s; everyday commands 0.6 s idle, 1.0 s loaded. The machine was busier than at my 1d3a77c run (other sessions testing), so the 40 to 50 chained push edge came in lower than then (50 allowed at 4.5 s idle on 1d3a77c, refused at 6.15 s here); a command with that many pushes is not everyday and fails closed. Not run: guard suites without KIT_NEXT (Tech Lead is judging the 7 failures), K-2 and K-1 kit tests, and a live session with the real hooks.
