---
piece: w6-18
role: qa
sha: 0bdb7f3
verdict: PASS
date: 2026-11-16
---

Re-stamp at 0bdb7f3 (claude/builder-b-w6-loop-017: 643c7da plus the token cap never 0 (clamped to a 100,000 minimum, steps and minutes keep 0 meaning off), the Cookie and Set-Cookie secret check, proc-guard cleanup retries, and a Ctrl+K palette test that waits for the page). Rehearsal e2e/w6-rehearsal.mjs (branch claude/qa-w6-rehearsal-2) run again on an invented profile for the scenarios the delta touches, every process stopped afterwards. Unit tests at 0bdb7f3: 588 pass, 0 fail, 48 s. The race named in my 643c7da stamp (e2e/workspace.spec.js:14, the command palette test) is GONE: 12 of 12 runs of that test alone and 3 of 3 runs of the whole workspace.spec.js (7 passed each) on a machine with 14 other Playwright runs and CPU at 88 percent. A full gate was not run by QA at this sha; the 643c7da gate had that one named failure and nothing else. Electron not run. The hand-over carries steps and plan to the model that takes over (F1 to F5 passed at 643c7da; the delta since is the secret check, which now also catches Cookie and Set-Cookie lines, covered by test/step-results.test.js and not exercised by me with a real cookie line). Not exercised: incognito keeps no notes, week-long note pruning.
