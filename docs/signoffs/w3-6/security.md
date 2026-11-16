---
piece: w3-6
role: security
sha: 1a1c364
verdict: PASS
date: 2026-11-16
---

PKCE, one-time state, iss check, https-only, no redirects, private-network refusal, tokens only in secret store, callback exception needs pending state; 43/43 tests. Conditions: W36-1 token not bound to the connector address (verified), W36-2 in-flight refresh restores a signed-out token (verified). Revoke-on-sign-out confirmed. See docs/security/2026-11-16-w3-6-signin-review.md
