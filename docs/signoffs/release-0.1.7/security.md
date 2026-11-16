---
piece: release-0.1.7
role: security
sha: bf83b01
verdict: PASS
date: 2026-11-16
---

bf83b01 = 909a439 + 3 lines in src/ui/token.js (one resend after another call refreshed the token; no new way to get a token, no loop) + e2e spec only. S-1 from outside re-run with the guard on: all attacks 403, page token 200; 27/27 request-guard tests. All 909a439 probe results stand (source otherwise identical).
