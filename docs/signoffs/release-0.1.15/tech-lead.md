---
piece: release-0.1.15
role: tech-lead
sha: 065b7e4f
verdict: PASS
date: 2026-11-25
---

Read-only spec cross-check of 260cb5de (table: docs/plans/v0115-crosscheck-260cb5de.md, 2ba37523) plus the B1 fix at 065b7e4f: quick-ask-answer.js:186 now treats only a saved false as off, with test/quick-ask-pc-default.test.js (unset, true, false); no other strict true reads of pcSearchEnabled. Built as specified: Quick ask fixes, Claude sign-in, Office files, engine rule lists, F1, F2, F8-F12, F13 option A (B not shipped), PG-1/2/3/5 (PG-4 absent), SETTINGS-OVERHAUL, ENGINE-SWITCH, ONE-INSTRUCTIONS (canaries PASS), FOLDER-RULES frozen copy and FG-2, REWIND, PROJECT-CONTEXT, INSTALL-ANYWHERE IA-0..5, 7, 8, 12. Non-blocking deviations: G2 F11 in-folder edits incl. run-later files skip the judge (app.js:4219), Security's call; F3 extends Chat 6 steps at a time, not 12; F4 curated list marked PROPOSED with no Security review recorded, npm/PyPI candidates not listed; F5 browser_panel is a fixed sentence, no card; F6 browser-panel fallback is a hint only; F7 threshold counts deferrable tools only, helpers not deferred. UNKNOWN: SIGNIN-OPEN real-CLI check (BROWSER honoured, URL with &) not recorded. Not checked against a written text: FG-1/FG-2, IA-10/IA-11 (no Security doc on origin). Security follow-ups (pre-existing): write through an existing file link (workspace inside mustExist:false), PG-5 repo clean filters. Nothing was run; the gate result is the Chief of Staff's.
