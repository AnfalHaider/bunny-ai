---
piece: release-0.1.8
role: security
sha: a6afcf5
verdict: PASS
date: 2026-11-17
---

Supersedes my PASS at e028d3b. git diff e028d3b a6afcf5 is three CSS files only (bunny-design-system.css, bunny-app-bindings.css, app.css; +34 -8): no script, route, guard or manifest file; the added lines hold no url(), @import, expression, behavior, javascript: or script. Everything in my e028d3b note stands, including the three items that ship open (P-6, L-4, RO-1) because W4-11 is not in this release.
