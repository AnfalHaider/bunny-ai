---
piece: w6-18
role: qa
sha: 643c7da
verdict: PASS
date: 2026-11-16
---

Re-stamp at 643c7da (claude/builder-b-w6-loop-017, the integration of w4-1c, w4-1d, w6-2, w6-3, w6-4, w6-18 and the W6-3b no-plan nudge, cut from main e3c3157 lineage, already merged so no scratch merge was needed). Rehearsal e2e/w6-rehearsal.mjs (branch claude/qa-w6-rehearsal-2) run in both modes on an invented profile, scripted model, local fixture repo and site; every process it started was stopped. GATE at 643c7da, one run on a loaded machine (16 other Playwright runs): 6 of 7; unit tests PASS (46 s); the one failure is e2e/workspace.spec.js:14 the command palette opens with Ctrl+K and runs a command (138 passed otherwise); it passes 8 of 9 runs alone, and it is a test race: it presses Control+k right after goto without waiting for the page to be ready, so the key press can land before the handler exists (also failed in my 47e2312 gate); not caused by this branch. Electron not run. Auto fallback through the real client with three providers (500, 30 s stall, cut stream, 429): the model that took over was given the steps with their results and the plan and finished the job (F1 to F4, 21 steps, nothing repeated once the note is read); F5: a 300-line command output reached the next model as 4,333 characters with first and last lines and a pointer to .bunny/notes (the saved file holds the 8,000-character cut result: the tool-result cut at 8,000 characters in src/server/app.js is applied first, my W6-0 gap G3). Not exercised: incognito keeps no notes, the secret-check changes (Authorization headers, sk_live_ keys), the week-long pruning.
