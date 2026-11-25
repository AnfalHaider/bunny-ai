---
piece: release-0.1.15
role: security
sha: 2cd562ec
verdict: PASS
date: 2026-11-25
---

Reviewed integration 2cd562ec (read only). Contains S-LINK-1 c71d780e and B1 065b7e4f, both passed. Diff c71d780e..2cd562ec over src, electron, scripts and package.json holds only what was expected: gate e2e reporting (gate.mjs, gate-report.mjs: the step now also fails on a missing or inconsistent JSON report, so the gate is stricter), scripts/unit-trace.mjs (a dev tool, not in the gate, writes nothing in the repository), the closing brace of the @media block and the chip ellipsis in app.css, the chip title set as an attribute (text stays textContent), skill file wording in customize.html, and Usage and data moved down in the Settings list. No electron or package.json change. Rechecked at this sha: every shipped autoJudgeEnabled read is !== false (app.js 999, 2683, 2742; engines/service.js 325); the only default-off is test/helpers.js:40; autoJudgeEnabled stays window-only; Stripe is not in curatedPlugins.js; the S-LINK-1 code is present. G2 ships with the release-note text Security gave (the Auto check does not look at edits inside the folder). Open follow-ups: G2-1 HIGH for v0.1.16 (run-later files and a script edited earlier in the same reply go to the judge); hard links (nlink>1) not caught; a link pointing nowhere used as a parent is refused by mkdir, not by an explicit check (LOW); real file links untested on a PC without developer mode (run test/workspace-links.test.js with developer mode on, expect 28 pass). Earlier LOWs still open: addressCancel null check, store-load test for ask, PC-1 to reuse holdsPcText, scoped npm alias refused, engine-chip innerHTML.
