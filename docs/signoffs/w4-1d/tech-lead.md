---
piece: w4-1d
role: tech-lead
sha: 2525aed
verdict: FAIL
date: 2026-11-16
---

Reviewed the supervisor (procGuard.js) and processes.js; the kill-the-server test passes and agent-tools tests pass (12/12). The design holds: the supervisor is detached, watches the server pid every 500 ms, stops the program's whole tree (taskkill /T, or the process group) and exits; the existing stop path still reaches the tree. One required fix: processes.js passes ELECTRON_RUN_AS_NODE=1 to the supervisor and procGuard spawns the program with the same environment, so every program the model starts inherits it (probed: a started node prints ERN=1). An Electron app, or a tool that launches Electron, started through Bunny would then run as plain node and fail. Fix: remove ELECTRON_RUN_AS_NODE from the environment procGuard gives the program (and add a test that the started program does not see it). Notes: the branch is cut from 9fb372f, not 19e1455 (it lacks LA-4 and the fake-stream pacing, so merge lane A before the gate); a very long command is now JSON-escaped on the supervisor's command line, so the Windows 32k limit is reached sooner (it was already reachable); if the supervisor itself is killed hard the program is left running. e2e not run by me.
