---
piece: release-0.1.9
role: qa
sha: b9bdd7a
verdict: PASS
date: 2026-11-17
---

Re-stamp at the final candidate b9bdd7a (final gate 9 of 9 per the Chief). Code changed since my walk at ec2afa2 in three files only: package.json (version 0.1.9), src/server/mcp.js (reads the version from package.json), src/ui/app.css (W6-16 layout fix). Re-run on b9bdd7a: updater e2e/w019-supd.mjs 38/38 and compareVersions('0.1.8','0.1.9') = -1, ('0.1.9','0.1.9') = 0 (a 0.1.8 copy is offered 0.1.9, a 0.1.9 copy is not); W6-16 e2e/w019-w616.mjs 20/20 (Customize 'Only in:' label readable, no overflow, light/dark/phone); layout e2e/w019-l1.mjs 66/66 (every Settings page, 800 and 390 px, light and dark); connectors/plugins e2e/w019-w411.mjs 13/13 (mcp.js changed); page walk e2e/w019-release.mjs 19/19 (picker, command and Plan-leave card, ask card, wait setting). Not re-run: docs, policy and test-only commits. Still not covered: the real hotkey and bar window (no OS keys for QA) and the real published 0.1.8 to 0.1.9 update, which the post-release gap walk checks.
