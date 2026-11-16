---
piece: release-0.1.7
role: librarian
sha: bf83b01
verdict: PASS
date: 2026-11-16
---

Librarian re-stamp of release-0.1.7 at bf83b01, after the PASS at 909a439. The one commit on top is Q2-23: a call whose stale-token 403 arrives after another call refreshed the token is sent again with it (src/ui/token.js, three lines), plus test changes in e2e/request-guard.spec.js. No visible text, so no help line is needed. The commit message has no Claude credit. The fix is inside bf83b01 itself, so the sha contains it (L007). Lessons L001 to L008 checked; none is newly due.
