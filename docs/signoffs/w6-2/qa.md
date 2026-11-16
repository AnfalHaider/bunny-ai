---
piece: w6-2
role: qa
sha: 0bdb7f3
verdict: PASS
date: 2026-11-16
---

Re-stamp at 0bdb7f3 (claude/builder-b-w6-loop-017: 643c7da plus the token cap never 0 (clamped to a 100,000 minimum, steps and minutes keep 0 meaning off), the Cookie and Set-Cookie secret check, proc-guard cleanup retries, and a Ctrl+K palette test that waits for the page). Rehearsal e2e/w6-rehearsal.mjs (branch claude/qa-w6-rehearsal-2) run again on an invented profile for the scenarios the delta touches, every process stopped afterwards. Unit tests at 0bdb7f3: 588 pass, 0 fail, 48 s. The race named in my 643c7da stamp (e2e/workspace.spec.js:14, the command palette test) is GONE: 12 of 12 runs of that test alone and 3 of 3 runs of the whole workspace.spec.js (7 passed each) on a machine with 14 other Playwright runs and CPU at 88 percent. A full gate was not run by QA at this sha; the 643c7da gate had that one named failure and nothing else. Electron not run. S6: the 35-write job finishes in one reply (35 steps, final All done); S13a and S13b: the loop check asks I have run the same step (run_command) three times in a row. Keep trying, or stop here? after the third repeat, Keep going continues, Stop here ends with a report. The new token-cap clamp was read in src/server/caps.js and the changed test/auto-continue.test.js, not exercised to the 100,000 limit.
