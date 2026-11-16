---
piece: w4-1d
role: security
sha: 2525aed
verdict: PASS
date: 2026-11-16
---

Supervisor kills only its own child tree, exits with it, no leak (probe + test). Follow-up W41d-1: ELECTRON_RUN_AS_NODE=1 leaks into started programs (verified); W41d-2 pid reuse LOW. See docs/security/2026-11-16-w4-1d-w6-18-w6-2-review.md
