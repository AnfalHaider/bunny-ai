---
piece: w6-18
role: tech-lead
sha: ca3e309
verdict: PASS
date: 2026-11-16
---

Reviewed the diff against 9fb372f (the branch is cut from 9fb372f, not 19e1455: merge lane A before the gate). Results are kept whole for a model that takes over (newest 12 steps 4,000 characters, older 400, 40,000 per turn), big results (over 6,000) are saved to .bunny/notes/step-*.txt with the path stored (only a path matching that pattern is accepted by the session store), and the plan and the latest two screenshots are carried over. Saving is limited to workspace tools, never in Plan mode, never through a linked .bunny or notes folder (lstat before mkdir, realpath check), with a .bunny/.gitignore of *. Unit suite at ca3e309: 554 pass, 1 fail (the known wall-clock 5,000-file search under load). Notes for the owner, not blocking: the files are written without a per-write question in Manual mode and are not in the undo list; they can hold anything a command printed (a secret), so the .gitignore matters; they are never cleaned up. e2e not run by me.
