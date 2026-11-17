---
piece: w6-7
role: security
sha: 5d7983d
verdict: PASS
date: 2026-11-17
---

shellFit.js is two pure functions: no spawn, no shell choice; run_command still always runs in PowerShell. Hints are fixed text from a table (the command is never echoed into a hint), added to the status only after a failure. 200 KB inputs take under 35 ms (no regex blow-up). 85 related tests pass.
