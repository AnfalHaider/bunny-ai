---
piece: w5-8
role: security
sha: 70bd964
verdict: PASS
date: 2026-11-16
---

Target must equal origin/main, fetch failure refused, no option injection, full sha to gh, 11/11 tests. Conditions: W58-1 check does not tie the installer to the sha (--target origin/main from another branch, untracked files under src, stale dist all pass); W58-2 extra gh flags pass through. See docs/security/2026-11-16-w5-7-w5-8-review.md
