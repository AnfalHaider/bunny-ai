---
piece: w4-1c
role: tech-lead
sha: 160ca5b
verdict: PASS
date: 2026-11-16
---

Reviewed the diff (package.json, processes.js, one new test) and probed node --test --test-timeout on node 26: a hanging test body and a hanging t.after hook both fail by name at the limit; an unsettled top-level await fails the file; a describe suite longer than the limit is not killed (5 x 0.5 s passed at 1 s), so no false failures from long suites. It is per test, with no retry or skip, so nothing is masked. Not covered: a handle left open after tests pass (setInterval) hangs node --test with no failure and the gate step (spawnSync, no timeout) waits forever; I did not test a synchronous spin. Follow-up, not blocking: give the unit-test step a gate-level timeout (about 10 min) so an open handle also fails. taskkill 15 s bound is fine; on timeout the tree may survive while the process is reported killed. Unit run at 160ca5b: 551 pass, 1 fail, three runs, a different wall-clock test each time under load (LA-2 many-files 7.5 s vs 3 s budget; 5,000-file 14 s), passing alone: the flake list is longer than W4-1b. e2e not run by me.
