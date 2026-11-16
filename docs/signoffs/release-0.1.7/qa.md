---
piece: release-0.1.7
role: qa
sha: bf83b01
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 909a439. bf83b01 is 909a439 plus one commit (Q2-23): git diff 909a439 bf83b01 shows two files only, src/ui/token.js (3 lines: a call whose stale-token 403 arrives after another call already refreshed the token is sent again with the new token instead of failing) and e2e/request-guard.spec.js (31 lines, test race fixes plus one more test, 7 tests now). request-guard.spec.js ten times at bf83b01: 10 passed, 0 failed (each run 7 passed, 4.6 to 9 s) on a machine with 14 other Playwright runs going. Everything I stamped at 909a439 stands because no other file changed: the merge read (each merge parent is a sha I stamped; the app.js conflict kept both sides), the W6 rehearsal in API and UI modes, the working-line walk 14 of 14, the settings sweep 4 of 4 with autoUpdate and fallbackWhenBusy window-only, the desktop screens walk 13 of 14, the rules walk 36 of 37 (the remaining row each is UNKNOWN: the real Electron preload and the Settings screen inside the shell). I did not re-run those walks at bf83b01, and no gate or unit run (the Chief runs the quiet gates). Not done: Electron, a real release.
