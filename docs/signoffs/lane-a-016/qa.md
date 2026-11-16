---
piece: lane-a-016
role: qa
sha: aebb866
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 19e1455. The delta 19e1455 to aebb866 is test-only (test/workspace-search.test.js, timing bounds measured in CPU time with room for a saturated machine); no app code changed, so my walk at 19e1455 (12 of 12) and gate (7 of 7) stand. Unit run at aebb866, named: run 1 hit my 400 s limit on a machine with about 97 node processes from other sessions and showed two timing failures, LA-2 regex search across many files stays fast (7.6 s, Search stopped after 5 s) and LA-4 the event loop keeps ticking while a regex search walks many files (5.6 s, Search stopped after 5 s); every test file passes on its own (test/workspace-search.test.js 30 of 30 twice, 7.7 s) and run 2 of the whole suite was clean: 553 pass, 0 fail, 47 s (8 todo). So the new bounds are not yet saturation-proof: the two tests fail when the whole suite runs on a loaded machine, because the 5 s total budget of the search itself (LA-4) is a wall-clock limit that the tests cannot loosen. Not a lane A defect; belongs to W4-1c. Walk script e2e/lane-a-walk.mjs. Electron not run.
