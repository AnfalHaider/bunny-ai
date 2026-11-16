---
piece: w4-1d
role: tech-lead
sha: fdafaa5
verdict: PASS
date: 2026-11-16
---

Re-review of 2525aed..fdafaa5. The environment leak is fixed: the supervisor now starts the program with every ELECTRON_* variable removed and stdin closed, and a test starts a program with an ELECTRON_ variable set and checks it sees neither that nor ELECTRON_RUN_AS_NODE. The supervisor also now dies when the pipe the server holds on its stdin ends (the pid poll stays as the fallback), which is stronger than a pid check alone. Lane A is merged. Probed in the earlier review: the kill-the-server test passes. Note: the supervisor itself, if killed hard, leaves the program running. e2e not run by me.
