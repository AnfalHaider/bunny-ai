---
piece: release-0.1.7
role: security
sha: 909a439
verdict: PASS
date: 2026-11-16
---

Read-only check during the quiet window: fix-bearing files identical to the signed tips (windowOnly table, secure:write, caps, secretLike, procGuard, release.mjs, guard-next); app.js keeps 9 window-only checks and all markers; W4-5c has no security effect. Merged-tree probes to follow after the window; a differing answer replaces this with FAIL. See docs/security/2026-11-16-release-0.1.7-merge-check.md
