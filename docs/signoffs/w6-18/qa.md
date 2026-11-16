---
piece: w6-18
role: qa
sha: ca3e309
verdict: PASS
date: 2026-11-16
---

Walked in a scratch merge of all five Builder B pieces on lane A 19e1455 (merge order w4-1d, w6-18, w6-2, w6-3, w6-4; scratch tip 56f06e4, local only), invented profile, scripted model, rehearsal e2e/w6-rehearsal.mjs. Merge conflicts: only w6-3 against w6-2, in src/server/app.js (two places) and src/server/chat.js (one): both sides added lines side by side, resolved by keeping both, syntax checked. The other merges were clean. Auto fallback through the real client with two providers (500, stall, cut stream, 429): the model that took over was given the steps with their results and the plan, carried on from the right step, and finished (F1 to F4, 21 steps, no step repeated once my scripted model read the note). F5: a 300-line command output reached the next model as 4,333 characters with the first and last lines and a pointer to .bunny/notes/step-*.txt; the saved file holds 7,996 characters. CAVEAT, not this piece: it is not literally full, because every workspace tool result is first cut to 8,000 characters (src/server/app.js:2389, my W6-0 gap G3), so the middle of a large output is gone before it is saved; the hand-over keeps the newest steps at up to 4,000 characters each within 40,000. Step notes are written under the project folder in .bunny with a .gitignore of *. A stale red The reply failed group still stays mid-transcript after a successful fallback (W6-0 gap G7). Full gate not run by QA on this piece.
