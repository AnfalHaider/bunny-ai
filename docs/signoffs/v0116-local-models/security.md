---
piece: v0116-local-models
role: security
sha: 3ab0e22d
verdict: PASS
date: 2026-11-27
---

SC-f: getJSON sends window-only GETs through the bridge; main still checks isOwn and isWindowOnlyRoute, no body on GET, a query fails closed; no server or route-list change; on top of 434eab71 and f7c917cc; 207 related tests 206 pass 0 fail 1 skipped in an invented profile
