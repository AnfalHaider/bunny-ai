---
piece: w6-4
role: qa
sha: 643c7da
verdict: PASS
date: 2026-11-16
---

Re-stamp at 643c7da (claude/builder-b-w6-loop-017, the integration of w4-1c, w4-1d, w6-2, w6-3, w6-4, w6-18 and the W6-3b no-plan nudge, cut from main e3c3157 lineage, already merged so no scratch merge was needed). Rehearsal e2e/w6-rehearsal.mjs (branch claude/qa-w6-rehearsal-2) run in both modes on an invented profile, scripted model, local fixture repo and site; every process it started was stopped. GATE at 643c7da, one run on a loaded machine (16 other Playwright runs): 6 of 7; unit tests PASS (46 s); the one failure is e2e/workspace.spec.js:14 the command palette opens with Ctrl+K and runs a command (138 passed otherwise); it passes 8 of 9 runs alone, and it is a test race: it presses Control+k right after goto without waiting for the page to be ready, so the key press can land before the handler exists (also failed in my 47e2312 gate); not caused by this branch. Electron not run. S14: a write_file cut off by the length limit never ran (no file, no step) and the model was sent back to resend smaller (2 requests). S11: a closed and an unclosed written-out call both ran (written.txt, written2.txt), no markup left in the saved chat.
