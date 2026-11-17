---
piece: w6-12
role: tech-lead
sha: 292bead
verdict: FAIL
date: 2026-11-17
---

Supersedes FAIL at c83c6d9. 292bead (c83c6d9 + one commit, app.js and the test only): carried steps are now quoted data, control characters and newlines turned to spaces, cut at 100, labelled as notes and not instructions; the nudge gives counts only; new test with an instruction-like step. That part is right. Still open from c83c6d9, unchanged: (1) REQUIRED, spec done-when 'exactly one nudge': the W6-12 nudge can fire up to 3 times per reply (shares permissionNudges) and test/w6-12-tasks.test.js still asserts 1..3 under a test named 'exactly one nudge' (line 111 now). Fix: a once-per-reply flag, assert === 1. (2) test: a reply that shows an ask_user card is not nudged. (3) test: sessions.append with 41 tasks saves 40. Tests not run by me.
