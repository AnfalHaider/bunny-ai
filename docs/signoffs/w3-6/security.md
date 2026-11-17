---
piece: w3-6
role: security
sha: e037514
verdict: PASS
date: 2026-11-17
---

Final: needsSignIn/keyRefused (a connector with its own key header never offers Sign in; status error, constant message, no header value), expired flag from doRefresh, token binding and sign-out race from 9209d78 unchanged; 44 related tests pass.
