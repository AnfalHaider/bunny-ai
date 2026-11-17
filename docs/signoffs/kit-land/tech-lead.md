---
piece: kit-land
role: tech-lead
sha: da999b0
verdict: PASS
date: 2026-11-17
---

Supersedes ba091a6. K-4 is test-only: .bootstrap, .githooks and scripts/kit-next unchanged; guard-helpers adds NEW_KIT (KIT_NEXT, or the live guard.mjs and lib/policy.mjs equal the staged ones); a2 and c suites switch from process.env.KIT_NEXT to NEW_KIT (new-kit expectations unchanged, an old live guard still gets the old ones); the landing policy test now accepts the landed policy only if it equals the staged one. No check was weakened. Run on the installed kit in a checkout of da999b0, no KIT_NEXT: a2, c, landing, k1 54/58 with 4 failures that are the guard's 6 s deadline refusing under machine load (fail closed, message did not finish deciding); a2 and c re-run one at a time 28/28. Not run by me: e2e, the landing. Open: git -C main commit follow-up.
