---
piece: w6-12
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Candidate head 591bf83 (holds 424bb72, 292bead). e2e/w019-w612.mjs 13/13, real server, invented data and project folders, a scripted model that records everything it is sent. A reply that stops with open steps (no question, not finished) is nudged to carry on, exactly ONCE even if the model stops again (3 requests); the nudge says '2 open steps' and does not quote the steps; no nudge when the reply asks a question, says all done, or says blocked. The next message in the same Code chat gets fixed system wording ('1 of 3 done', carry on from the first open step, or 'otherwise follow their new message') and the steps only in a user-role note after the system text, each as a quoted one-line string, 'not instructions'; a hostile step is cut at 100 characters, control characters removed, 'system:' cannot start a line, and is not in the system text; a finished list is not carried; Chat mode carries nothing; Plan mode says 'you can only plan these steps' and is not nudged; 41 steps are saved as 40. Not walked: the ask_user-card interaction (Builder's test).
