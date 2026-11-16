---
piece: lane-a-016
role: qa
sha: 19e1455
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 9fb372f (19e1455 adds LA-4, a 5 s budget for regex searches). Gate at 19e1455, one run under machine load: 7/7 (unit 74s, e2e 339s), no failing test. Walk of a Code chat on an invented folder, 12 of 12 PASS: search_files regex plus case switch plus path plus include reads Searched for /TODO[digits]/ in src (*.js) with the right matches only; find_files reads Searched for files matching **/*.test.js, newest first; a search and a find in one reply group as Searched two times; counts output works; an invalid regex is a clear failed step; multi_edit with a failing edit changes nothing and shows no Undo; multi_edit with three edits gives one Undo card and one Changes card, and Undo restores the file byte for byte; a catastrophic regex stops in 2 s with That pattern is too slow; a pathological glob answers in 0.7 s; an edit past 20 MB is refused and the file is untouched. NOT exercised: the LA-4 5 s total budget message on a very large folder (covered by Builder unit tests only), and the two-gates-at-once proof, which the Chief runs at assembly. Walk script e2e/lane-a-walk.mjs. Electron not run.
