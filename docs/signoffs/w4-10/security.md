---
piece: w4-10
role: security
sha: 9209d78
verdict: PASS
date: 2026-11-17
---

appTools.uninstall now signs remote connectors out (signOutQuietly) before it removes them; real uninstall with a stub ran sign-out, stop, remove, then the skill; my W3-6 note is closed. Routes still window-only; 72/72 tests.
