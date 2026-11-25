---
piece: release-0.1.15
role: tech-lead
sha: 2cd562ec
verdict: PASS
date: 2026-11-25
---

Supersedes 22c24faa (PASS at 065b7e4f). Read only, 065b7e4f..2cd562ec (an ancestor). App code: S-LINK-1 c71d780e, workspace inside() with mustExist false now refuses an existing link (file link, junction, dangling) and checks an existing target's real path and every parent against the protected folders; this closes my follow-up 1 for write_file and make_*. F4-1 drops Stripe from the curated list. Settings: the unclosed @media block closed in app.css and its source docs/design/bunny-app-bindings.css (css check stays consistent); Usage and data moved second to last as drawn; 'skill file' wording in Customize; the chip ellipsis below 600 px with the full words in title (tight-rows.js). Gate: 2c86c8f5 GATE-E2E-LIST (my PASS: G1 to G5). Tests: fa4303cc local-connector stand-in exits at once (still asserts the exact quoted command line); scripts/unit-trace.mjs; e2e specs follow the Settings overhaul (exact section lists, Google note text, the Auto check row under Permissions, save on blur); picture scenes start from shipped defaults. No assertion weakened. Nothing contradicts a spec. Still open, non-blocking (from 22c24faa): G2 F11 in-folder run-later edits skip the judge (Security's call); F3, F4 npm/PyPI candidates, F5 browser_panel, F6 fallback hint, F7 threshold and helpers; SIGNIN-OPEN real-CLI check UNKNOWN; FG-1/FG-2 and IA-10/IA-11 judged against the code only; PG-5 repository clean filters. Nothing run; the gate result is the Chief of Staff's.
