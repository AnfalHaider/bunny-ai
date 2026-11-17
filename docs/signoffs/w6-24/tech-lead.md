---
piece: w6-24
role: tech-lead
sha: 8f66eb2
verdict: PASS
date: 2026-11-17
---

Read electron/browserViews.js, the browserAgent.js controlView, the main.js and preload diff and the browser-pane.js view code. Matches my spec: one partition (persist:bunny-browser), sandbox, contextIsolation, no node, no preload; http(s) only, never Bunny's own port in any loopback spelling (URL-normalised IPv4, ::ffff mapped); a session-level request filter; window.open is denied and becomes a tab; permissions, device pickers and downloads refused; senderAllowed means only Bunny's own top frame in a Bunny window, and only views it opened; the model's actions run in an isolated world; did-fail-load and download notes reach the panel; views close with their page; the view steps aside when a .menu, dialog or slash list overlaps it. The header-dropping hook is removed. Security owns the security sign-off. Not run by me: test/browser-views.test.js and the real-window walk (QA).
