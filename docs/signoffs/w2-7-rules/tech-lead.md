---
piece: w2-7-rules
role: tech-lead
sha: 32a3a8c
verdict: PASS
date: 2026-11-16
---

Re-stamped at 32a3a8c (W5-7, which contains W2-7 at 8e42b6a). The one open fix of my 8e42b6a FAIL, the permission mode through POST /api/sessions and PATCH /api/sessions/:id, is closed by W5-7: probed in desktop mode with only the page token, both return 403 (see the w5-7 sign-off for the probe list). The quote-stripped matching, the leading git and gh options and the drive wrappers were already verified at 8e42b6a. Unit tests window-only, panes, permission-rules-app and api: 68 pass, 0 fail. This sign-off covers W2-7 only together with W5-7: land them as one. e2e not run by me.
