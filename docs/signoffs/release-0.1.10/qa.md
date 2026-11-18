---
piece: release-0.1.10
role: qa
sha: 0e5bc55
verdict: FAIL
date: 2026-11-18
---

Re-walk on 0e5bc55 (RA-1 changed only remoteAccess.js). RA-1 PASS (e2e/w0110-signin.mjs 6/6): 4 wrong then the 5th says wait 30 s; the right passcode during the wait is refused; it signs in after the wait (61 s by hand in the page); 60 parallel wrong tries -> 5 checked (401) and 55 told to wait (429); right passcode right after the burst waits; signs in 32 s later. Everything else from the 9d4e942 walk unchanged (e2e/w0110-walk.mjs 71 of 78, e2e/w0110-electron.mjs 24 of 24). STILL FAIL: F-1 a signed-in device cannot answer its chat's permission card in the page (src/ui/api.js sendJSON refuses window-only routes with no bridge, no device exemption; checks 6.4c 6.5 6.6; the server accepts, 404 for an unknown card id); F-2 LOW rules Pattern box and Add rule only aria-disabled in a tab. Neither is touched by RA-1.
