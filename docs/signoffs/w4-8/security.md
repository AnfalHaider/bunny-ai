---
piece: w4-8
role: security
sha: e061ce6
verdict: PASS
date: 2026-11-16
---

Capture only from the bar's own IPC after the Add-a-screenshot click (one desktopCapturer call site), one PNG kept in memory until sent then only in the new Chat-mode chat; sandboxed bar with closed CSP; quickAskEnabled/quickAskShortcut 403 with the page token; shortcut off by default. 38/38 tests; no Electron run. See docs/security/2026-11-17-w4-8-w4-10-review.md
