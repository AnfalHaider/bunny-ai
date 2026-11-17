---
piece: gate-names
role: tech-lead
sha: 88b6082
verdict: PASS
date: 2026-11-17
---

git diff 91e1631 88b6082 -- scripts/gate.mjs: 8 added, 2 changed. A new failures option on step(), set only for the unit step, prints the lines that mark failures (failing tests, assertion and error lines, totals; at most 120, each cut to 300 characters) after the usual tail, and only when the step failed. pass/fail and the other steps are unchanged; output only. Not exercised by me on a failing run.
