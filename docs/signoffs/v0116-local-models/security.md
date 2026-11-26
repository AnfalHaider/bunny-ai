---
piece: v0116-local-models
role: security
sha: 434eab71
verdict: PASS
date: 2026-11-26
---

status() race fix: snapshot and at most 3 reads, same answer shape, no caller passes the retry count, no route or window-only change; on top of the T1-T3 review at f7c917cc; 204 related tests 203 pass 0 fail 1 skipped in an invented profile
