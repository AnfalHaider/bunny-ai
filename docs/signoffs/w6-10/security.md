---
piece: w6-10
role: security
sha: 9859ea6
verdict: FAIL
date: 2026-11-17
---

W610-1 (MEDIUM): a local page captured with allowLoopback can name http://127.0.0.1:<Bunny port>/; fetchLimited sends Host 127.0.0.1:<port> and no Origin or Sec-Fetch, so requestGuard serves index.html with the launch token (meta bunny-token) and capture saves it in the workspace, readable by the model; Accept mode needs no card. Fix: capture (and fetchLimited for every caller) refuses Bunny's own port in every loopback spelling, re-checked on redirects. W610-2 (LOW-MEDIUM): only captures/.../index.html is checked against the person's rules; check every written path (any deny: write nothing; any ask: one card). Read-only review; tests after the gate.
