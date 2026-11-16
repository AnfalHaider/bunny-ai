---
piece: release-0.1.7
role: security
sha: 909a439
verdict: PASS
date: 2026-11-16
---

Reading check plus post-window probes on 909a439, all as signed: token-only writes 403 (autoUpdate, fallbackWhenBusy, updateUrl too), rule probes no bypass, guard probe 45 mismatches identical to 900a470, caps/secretLike/procGuard as signed, release.mjs dry run lists all failing checks and publishes nothing. Gate and e2e not run by me; the two Q2-23 request-guard e2e failures are open with Builder A.
