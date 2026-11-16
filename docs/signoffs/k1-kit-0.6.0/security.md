---
piece: k1-kit-0.6.0
role: security
sha: 714a0a8
verdict: FAIL
date: 2026-11-16
---

714a0a8 fix round verified (registry/env role writes, fetch+pull refspecs, command-line config, case-insensitive guard paths, nested repo with own policy) with no regression, 21/21 checklist. Same two blockers as 8c39d76, untouched by this round: K1-1 bootstrap role accepts ../../AGENTS and ../../docs/a (bootstrap.mjs unchanged); K1-2 nested-repo rule holds only if the hook runs in the project folder (6/6 allowed otherwise). See docs/security/2026-11-17-k1-kit-next-review-714a0a8.md
