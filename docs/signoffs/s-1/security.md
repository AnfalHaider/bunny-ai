---
piece: s-1
role: security
sha: ca01243
verdict: FAIL
date: 2026-11-15
---

Attacks refused on an invented profile: no token, wrong or foreign Host, foreign or null Origin, cross-site and same-site fetch, token with foreign Origin, token in query string, preflight. REGRESSION: the Google sign-in return (GET /api/account/google/callback) is a cross-site browser navigation with no token and gets 403 request.badOrigin, so Google sign-in cannot finish. Allow that one GET without token and cross-site (still Host checked; its random state and PKCE protect it) and add a test. Not covered by this build: local connector confirm still a request flag; JSON content type not required.
