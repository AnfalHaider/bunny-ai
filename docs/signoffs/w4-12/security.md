---
piece: w4-12
role: security
sha: c2da6a8
verdict: PASS
date: 2026-11-17
---

A typed message can only answer a Bunny question card: state.openQuestion is set in one place (showLiveQuestion, the ask_user and keep-going cards); permission and capability cards (run_command, local connector, write_file, schedule, leave_plan_mode) are other functions with their own routes (/permission/<id> with allowed, /capability/<id> with granted) that the message box never calls, and the question route can only resolve a pendingQuestions id of that session, so typed text can never resolve a permission or capability id. All three answer routes stay window-only. Server side: yes/continue/go on carry on only in the limit-check question, only when nothing was clicked and the answer was not skipped; a background or ended reply is skipped (askQuestion resolves skipped when the response has ended), so it stops and cannot be answered. Carrying on adds no permission: every later tool still asks or runs under the same mode. 53 tests pass. LOW, usability: a typed 'yes, but skip X' carries on and the words after yes are dropped (not passed to the model).
