---
piece: w5-7
role: tech-lead
sha: 32a3a8c
verdict: PASS
date: 2026-11-16
---

Reviewed 8e42b6a..32a3a8c. One route table (windowOnly.js) with a matching copy in the page's api.js (the test keeps them equal), enforced twice: at the top of the request handler for routes that are window-only whatever the body says, and in the handlers that read a body (sessions create and patch, projects, settings). I compared every table pattern with the handler's own regex: they are the same, so no id shape gets past the table and into a handler. Probed in desktop mode with only the page token: POST /api/sessions and PATCH /api/sessions/:id with permissionMode auto, settings with allowlist, connectors (mcp), skills, hooks, terminal, computer and project instructions all return 403; ordinary patches, theme, effort and fork stay 200. This also closes the open fix in my w2-7-rules review (permissionMode through the session create and patch routes). Unit tests window-only, panes, permission-rules-app and api: 68 pass, 0 fail. customize.html now goes through sendJSON, so its adds use the window's channel. Merge check: with Builder B's W6-2, W6-18 and W4-1d it merges cleanly (api.js and app.js too); the only conflicts left are the known W6-3, W6-4 and W4-5b ones, not caused by W5-7. Not blocking, recommended next: memory writes (POST /api/memory and /api/memory/import) still work with only the token and they steer the model like instructions do, so they belong in the table; the main process forwards any table route from an own page, so keep the table small. e2e not run by me.
