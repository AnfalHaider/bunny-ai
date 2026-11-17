---
piece: w6-12
role: tech-lead
sha: c83c6d9
verdict: FAIL
date: 2026-11-17
---

Read the whole diff (agentTools, app.js, chat.js, sessions.js, test). Correct: the newest saved list with an open step seeds currentTasks and the system text; a finished list is not carried; Chat mode and no folder are not seeded; Plan mode is told plan-only and never nudged; the seeded list is saved with the reply; cleanTasks and sessions.js keep 40; helpers never reach this path (update_tasks answers Noted under agentScope). REQUIRED (spec done-when: exactly one nudge): app.js onReplyEnd can nudge up to 3 times per reply (it shares permissionNudges), and test/w6-12-tasks.test.js:105 is named 'exactly one nudge' but asserts 1..3 (line 110). Fix: a tasksNudged flag so the W6-12 nudge fires at most once per reply, assert nudges.length === 1. Also add the two missing done-when cases: a reply that shows an ask_user card is not nudged, and sessions.append with 41 tasks saves 40. Not blocking: the W6-3 JSDoc for asksPermissionToContinue now sits above statesDoneOrBlocked (chat.js:532); agentTools.js comment still says 20; askedThisReply is set even when W4-14c withholds the question, so that reply is not nudged. Tests not run by me (reading only while the gate runs).
