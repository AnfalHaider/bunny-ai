---
piece: release-0.1.10
role: tech-lead
sha: 975970a
verdict: PASS
date: 2026-11-18
---

Supersedes FAIL at 9d4e942. RA-1 fixed at 0e5bc55: remote-access.test.js alone 34/34; my race script, 60 parallel wrong passcodes from one IP, gives 5x401 + 55x429. 975970a (F-1/F-2, client only: api.js, browser-mode.js): deviceException mirrors the server's remoteException; the server still decides; the re-lock cannot loop (it watches only disabled, set only when off); browser-mode.test.js alone 7/7. Fast-forwards only since 9d4e942 (0 merges). Gate 9/9 at 975970a (Chief's gate evidence for 975970a, e2e 270 passed). The earlier review at 9d4e942 (15 merges with no lost lines, app.css == build, RUN, safeExec.js, remote routing) stands.
