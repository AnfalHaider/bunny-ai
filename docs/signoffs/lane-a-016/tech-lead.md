---
piece: lane-a-016
role: tech-lead
sha: 19e1455
verdict: PASS
date: 2026-11-16
---

Delta review of 9fb372f..19e1455. LA-4: regex time is summed per search with a clock around each file's scan; the next file throws 'Search stopped after 5 s; narrow the folder or the pattern.' once 5 s is spent, and each file's limit is the smaller of 1 s and what is left (floor 50 ms), so the total overshoots by under 50 ms. The error travels the same way as the existing too-slow error, and the literal path is unchanged. setImmediate between files only for regex searches lets the loop tick, though one file's scan can still hold it for up to 1 s. Time spent reading files is not counted (not a regex risk). Tests: the injected-clock budget test and the loop-ticks test pass. Unit suite at 19e1455: 553 pass, 0 fail. The W4-1b fake-upstream pacing change is the same as 611dee7's: only inside fakeStream, reachable with fake=true, so real providers are untouched. Minor: clock defaults to Date.now, a monotonic clock would be cleaner; the per-file yield adds some wall time on huge folders (the many-files test took 2.7 s here). e2e not run by me.
