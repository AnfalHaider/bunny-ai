---
piece: k1-kit-0.6.0
role: security
sha: f45f024
verdict: PASS
date: 2026-11-16
---

Landing commit f45f024: only guard.mjs changed (64 KB and 2,000-part limits, refused unread in 0.2 s; 1,999 plain parts read in 0.6 s). Conditions as before. K1-5 open and accepted for landing: shapes that start a process per part (git push x100 = 6.2 s, x150+main = 9.1 s, x300 = 18.4 s, x1999 = 232 s) still exceed the 10 s hook timeout; same in the live guard; fix proposed (branch read once, deadline, child with timeout). flow-editor.html note does not block. See docs/security/2026-11-17-k1-landing-f45f024.md
