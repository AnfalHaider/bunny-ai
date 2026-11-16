---
piece: w4-1d
role: qa
sha: 2525aed
verdict: PASS
date: 2026-11-16
---

Walked in a scratch merge of all five Builder B pieces on lane A 19e1455 (merge order w4-1d, w6-18, w6-2, w6-3, w6-4; scratch tip 56f06e4, local only), invented profile, scripted model, rehearsal e2e/w6-rehearsal.mjs. Merge conflicts: only w6-3 against w6-2, in src/server/app.js (two places) and src/server/chat.js (one): both sides added lines side by side, resolved by keeping both, syntax checked. The other merges were clean. S12: a program started with start_process (a server on a free port) was listening before the kill and was GONE 8 s after the Bunny server was killed hard; at lane A 19e1455 without this piece the same program was STILL listening after the kill (the leak). test/proc-guard.test.js passes alone (2 of 2 runs, 2.0 s and 2.9 s) and failed once inside a loaded multi-file run. Full gate not run by QA on this piece.
