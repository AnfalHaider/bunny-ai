---
piece: w6-17
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W6-17 at 304e71a, rows W617. timeout_seconds 2 stops a command that sleeps 8 s after 2.6 s with stopped after 2 seconds; the program the command started is dead (whole tree); over 10 s the step line shows Running 5 s of up to 30 s; 601 shows up to 10 min and 300 up to 5 min; 0, -5, text, null and 1.5 do not break the command; no timeout shows no up-to note. NOT RUN: the 120 s default and a 10 minute run (constants read only).
