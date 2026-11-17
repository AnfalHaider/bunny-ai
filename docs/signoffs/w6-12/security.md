---
piece: w6-12
role: security
sha: 292bead
verdict: FAIL
date: 2026-11-17
---

W612-1 (MEDIUM-LOW): carried task steps are model-written text (possibly after reading untrusted content) placed in the SYSTEM message next to 'Carry on from the first open step', and the nudge pushes open steps up to 3 times without the person. Fix: the steps go in a user-role message after the app's system text (as W4-11 L-1); the system text keeps only fixed wording; the carry-on line defers to the person's new message ('if the person's new message is about this work'). Quoting, 100-char cut and counts-only nudge are good; keep them. Read-only review, no tests run (gate slot).
