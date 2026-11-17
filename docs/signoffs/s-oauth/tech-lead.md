---
piece: s-oauth
role: tech-lead
sha: f929949
verdict: PASS
date: 2026-11-17
---

Read src/server/mcpOAuth.js. In production createConnectorSignIn passes no fetchImpl (app.js:272, connectorSignIn.js:28), so every non-loopback sign-in request resolves its host (all addresses), refuses if any is private (download.js isPrivateAddress) and connects through pinnedFetch to the checked address (no second DNS lookup; TLS still checks the hostname; redirects refused). Loopback is exempt only for local connectors: remote connectors' discovered endpoints are still refused lexically by notRemoteSafe (mcpOAuth.js:62, 181, 225, 238). Tests read, not run by me.
