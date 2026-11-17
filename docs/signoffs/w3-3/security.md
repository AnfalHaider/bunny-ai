---
piece: w3-3
role: security
sha: 821de5d
verdict: PASS
date: 2026-11-17
---

Mechanics hold: in Auto, create_tool, schedule_task with may_change === true (the same strict test that sets the schedule to auto) and add_connector with a command (also forced by W6-14) all ask; an allow rule cannot skip a build question; all three needsOk call sites pass name and arguments (wiring test); unattended or closed chat answers no; the W614-1 refusals survived the merge (card-too-long checks still on both branches, padded cases pass in ask, accept and auto). 85 tests pass. Open, MEDIUM W33-1, not blocking: the schedule question shows only the name and the interval, never the prompt that will run unwatched in Auto (agentTools.js describeAgentTool; detail is empty); this was already so in Manual and Accept. Fix: show the prompt on the card, with the refuse-when-too-long rule.
