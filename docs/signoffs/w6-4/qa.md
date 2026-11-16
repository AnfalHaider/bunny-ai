---
piece: w6-4
role: qa
sha: 71b8fff
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 442d61c. Re-checked in a scratch merge of the current tips of all five Builder B pieces on lane A 19e1455 (w4-1d fdafaa5, w6-18 a09ca84, w6-2 ea067ae, w6-3 2617d6d, w6-4 71b8fff; scratch tip 9c0acbb, local only), invented profile, scripted model, e2e/w6-rehearsal.mjs. MERGE CONFLICTS: w6-3 against w6-2 in src/server/app.js (two places) and src/server/chat.js (one), both sides added lines side by side; this time keeping both broke syntax once (the closing brace of w6-2's onLimit callback was lost, restored by hand). w6-4 against w6-2 in src/server/chat.js (two hunks) is a real overlap: w6-2 rewrote the round loop head and the tool-call push, w6-4 added a cutOffCalls counter and cleaned calls; hand-resolved keeping w6-2's loop and limits and adding w6-4's counter and cleaned calls. Builder B should expect these when assembling. Unit tests auto-continue, ask-dont-stop, written-calls, step-results and history pass 31 of 31 on the merge. Full gate not run by QA for this re-check. S14: a write_file whose arguments were cut off by the length limit (finish reason length, content cut mid-word) never ran: cut.txt does not exist, the step list is empty, and the model was sent back a message about resending in smaller pieces (its next request carried it; it answered with a resend promise). S11 again: a closed and an unclosed written-out call still ran (written.txt, written2.txt), no markup left in the saved chat.
