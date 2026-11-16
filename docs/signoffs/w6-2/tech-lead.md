---
piece: w6-2
role: tech-lead
sha: 643c7da
verdict: PASS
date: 2026-11-16
---

Integration branch 643c7da reviewed as merged. Read the whole streamChat loop after the conflict resolutions: the loop is one for(;;) with the step extension, the onLimit check (round over 0), cut-off calls (cutOffCalls, at most 3) and the permission nudge (at most 3), onLimit's closing brace is in place, a refused extension or a no from onLimit breaks to finalAnswer, an abort returns, and every continue still advances the round counter, so the step, time and token caps bind. Syntax check clean; unit suite at 643c7da: 595 tests, 587 pass, 0 fail (8 skipped). A trial merge of the W5-7 line (32a3a8c) into it has no conflicts, including app.js and api.js. e2e not run by me. W6-2: caps clamped on the server, scheduled runs get less, the token, repeat and stall checks ask in a waiting card. A stored 0 now means off for steps and minutes (no extension), which is the safe direction. Not blocking: a stored 0 for the token budget also turns the budget off, and autoContinueSteps, Minutes and Tokens are not in the window-only settings list, so a program holding the page token can disable the budget or raise the caps; add the three keys to the window-only list or make 0 mean the default for tokens.
