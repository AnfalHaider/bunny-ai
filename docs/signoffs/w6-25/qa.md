---
piece: w6-25
role: qa
sha: 3274621
verdict: PASS
date: 2026-11-17
---

e2e/w019-small.mjs 34/34 covers W6-19, W6-23 and W6-25 (nudge once after waitNudgeMs; a question, permission prompt or capability card is not answered or denied by a timer; a retry clears the failed attempts' red notes). Notes: the W6-19 job words are broad (e.g. 'match the regex on the page', 'copy the page title into the readme' count as see jobs: harmless in Auto, but a hand-picked non-vision model gets a false 'cannot look at pictures' line); the nudge fires once and never repeats.
