---
piece: release-0.1.12
role: tech-lead
sha: eba5478
verdict: PASS
date: 2026-11-18
---

Rebase: git range-diff origin/claude/builder-a-webapp (6d20c63 on 77f6324) vs 4cebedc..9273cd8, all 6 commits '=' (identical patches); then Version 0.1.12 (5878bca), 16d9296 (old-worker clear in the background, 3 s timeout, no flag on timeout) and eba5478 (q2-audit expects 16 sections). app.css == build at 4cebedc and 5878bca; no CSS changes after 5878bca. webapp.js: exact paths by Object.hasOwn on a frozen map; before sign-in only the manifest and icons. bunny-sw.js: pages from the network only; mayCache refuses /api/, other origins, query strings, token headers, HTML except offline.html, token.js, signin.js and remote.js; the token is only in HTML (app.js:3403). Tests alone: webapp.test.js 10/10, clear-old-workers.test.js 3/3 at eba5478. Gate 9/9 at eba5478 per the Chief of Staff (e2e 315/315).
