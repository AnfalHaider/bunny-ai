---
piece: w4-10
role: security
sha: e061ce6
verdict: PASS
date: 2026-11-16
---

POST /api/plugins, DELETE /api/plugins/:id, /api/plugins/install and the plugins key answer 403 to the page token; uninstall removes only ids recorded at install (add always makes new ids); bundles add only remote connectors. Note: uninstall must sign connectors out once W3-6 lands. See docs/security/2026-11-17-w4-8-w4-10-review.md
