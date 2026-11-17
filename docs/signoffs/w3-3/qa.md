---
piece: w3-3
role: qa
sha: 821de5d
verdict: PASS
date: 2026-11-17
---

W3-3 at 821de5d, invented profile, scripted model, every answer through the real confirmation cards. In Auto: create_tool shows one card (Manual and Accept too); schedule_task with may_change true asks once; add_connector with a command asks once and the card shows the exact command line; Deny on each builds or adds nothing, Allow on create_tool builds it. May_change false, missing or the text true runs unasked and the stored task for the text true is a read-only plan-mode task. A remote connector by address, and a blank command with an address, run unasked; a command plus an address asks. A program not on the list (powershell) is refused with a plain message. Write file and run command in Auto still run unasked; Manual still asks. Walk e2e/w6-la4b-w33-walk.mjs rows A1-D4, 28 of 28. Not proven: computer-use calls in Auto (computer use is off on the invented profile; the asksInAuto unit test covers the name).
