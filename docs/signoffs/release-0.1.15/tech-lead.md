---
piece: release-0.1.15
role: tech-lead
sha: 7c81da08
verdict: PASS
date: 2026-11-25
---

Supersedes baa6a8b6 (PASS at 2cd562ec). 2cd562ec is an ancestor of 7c81da08; git diff --stat 2cd562ec 7c81da08 shows README.md, docs/images/permission-rules.png and docs/images/pictures.json only (eb2c4f8d, 0d4e21f7, 7c81da08): no src, electron, scripts, test, e2e or .bootstrap change. README text read: the folder-trust card's second question (Run in Auto here, Trusted folders under Settings > Permissions) matches FOLDER-RULES-spec (two separate questions). Code review unchanged from 2cd562ec; gate 12/12 at 7c81da08 per the Chief (not re-run by me). Non-blocking items as in baa6a8b6: G2 (Security's call), F3-F7 deviations, SIGNIN-OPEN real-CLI check UNKNOWN, FG-1/FG-2 and IA-10/IA-11 judged against code only, PG-5 repository clean filters.
