---
piece: lane-a-016
role: qa
sha: 9fb372f
verdict: PASS
date: 2026-11-16
---

Lane A at 9fb372f. Gate 3 runs, all 7/7: two at the same time in two worktrees (random e2e ports 59782 and 59786, unit 85s and 84s, e2e 284s and 277s, no collision, no hang) and a third alone (unit 38s, e2e 207s); no failing test in any run. Walk of a Code chat on an invented folder, 12 of 12 PASS: search_files regex plus case switch plus path plus include reads Searched for /TODO[digits]/ in src (*.js) with the right matches only; find_files reads Searched for files matching **/*.test.js and lists newest first; a search and a find in one reply group as Searched two times; counts output works; an invalid regex is a clear failed step; multi_edit with a failing edit changes nothing and shows no Undo; multi_edit with three edits gives one Undo card and one checkpoint card, and Undo restores the file byte for byte; a catastrophic regex stops in 1.9s with That pattern is too slow; a pathological glob answers in 0.6s; an edit past 20 MB is refused and the file is untouched. Walk script e2e/lane-a-walk.mjs. Electron not run.
