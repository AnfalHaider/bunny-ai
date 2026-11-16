---
piece: w6-2
role: qa
sha: ea067ae
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 92cc6d7. Re-checked in a scratch merge of the current tips of all five Builder B pieces on lane A 19e1455 (w4-1d fdafaa5, w6-18 a09ca84, w6-2 ea067ae, w6-3 2617d6d, w6-4 71b8fff; scratch tip 9c0acbb, local only), invented profile, scripted model, e2e/w6-rehearsal.mjs. MERGE CONFLICTS: w6-3 against w6-2 in src/server/app.js (two places) and src/server/chat.js (one), both sides added lines side by side; this time keeping both broke syntax once (the closing brace of w6-2's onLimit callback was lost, restored by hand). w6-4 against w6-2 in src/server/chat.js (two hunks) is a real overlap: w6-2 rewrote the round loop head and the tool-call push, w6-4 added a cutOffCalls counter and cleaned calls; hand-resolved keeping w6-2's loop and limits and adding w6-4's counter and cleaned calls. Builder B should expect these when assembling. Unit tests auto-continue, ask-dont-stop, written-calls, step-results and history pass 31 of 31 on the merge. Full gate not run by QA for this re-check. S6: 35 write_file calls in one reply still finish (35 steps, final All done, a working event shown). S13a: the same run_command repeated: a card asked I have run the same step (run_command) three times in a row. Keep trying, or stop here? after the third repeat, Keep going continued, and it asked again after the next three. S13b: answering Stop here ended the reply with a report after 3 repeats plus the question (4 steps). Token budget and 25-round no-progress checks, the clamped Settings caps and scheduled-run defaults were read in the diff, not exercised.
