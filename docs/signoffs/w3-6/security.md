---
piece: w3-6
role: security
sha: 3155e20
verdict: PASS
date: 2026-11-16
---

W36-1 and W36-2 closed at 3155e20 (claude/builder-a-w36-sec): token sent only to the origin it was issued for (other host, http, port, subdomain, look-alike, userinfo trick, pre-fix token: nothing sent); address edit signs out; renewal in flight cannot restore a signed-out token (token absent after both finish, revoke called). 48/48 tests. Not yet on the v0.1.8 line; uninstall must sign connectors out on merge. See docs/security/2026-11-17-w3-6-fixes-and-queue.md
