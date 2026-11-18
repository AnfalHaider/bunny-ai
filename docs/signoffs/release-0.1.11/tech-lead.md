---
piece: release-0.1.11
role: tech-lead
sha: ea1bd05
verdict: PASS
date: 2026-11-18
---

ea1bd05 = 28812e1 + a docs-only merge (git diff --stat 28812e1 ea1bd05: only the v0.1.11 and v0.1.12 plan docs; lost-lines on ea1bd05: 0 from each parent). 2536e86..1c48183 reviewed earlier: merge ec6da3c 0 lost lines, bindings.css and app.css change the same lines, is-auto set at chat.js:350, #remote-bar and .app both direct children of body. 28812e1: the phone chip is max-width min(55vw, 100vw - 190px), min-width 0, shrinkable; .send-btn, .stop-btn and .icon-btn are flex: none, all present in the composer row (index.html); the same lines in bindings.css and app.css. app.css == build at c1c0e8d, ec6da3c, 1c48183, 28812e1 and ea1bd05. Gate 9/9 at 28812e1 per the Chief of Staff (e2e 304/304).
