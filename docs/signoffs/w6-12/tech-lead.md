---
piece: w6-12
role: tech-lead
sha: 424bb72
verdict: PASS
date: 2026-11-17
---

Supersedes FAIL at 292bead. All three items in: taskNudged makes the nudge once per reply and the test asserts exactly 1; an ask_user card means no nudge (test); 41 tasks save 40 (test). Security's change: system text fixed wording only, steps as a quoted user-role note before the conversation, the person's message last (tests). Run alone at 424bb72: node --test test/w6-12-tasks.test.js: 12 tests, 12 pass, 0 fail. Consecutive user messages are merged by ROLES (b57b606). NOTE: 424bb72 is not in candidate 88b6082.
