---
piece: settings-bridge
role: qa
sha: 807176d
verdict: PASS
date: 2026-11-18
---

807176d = 975970a + a docs-only merge (git diff 975970a 807176d touches only docs/plans/2026-11-18-v0.1.10-plan.md, +10 lines, checked by me); walk and gate at 975970a. Real Electron walk e2e/w110-bridge.mjs on 975970a: 25 of 25 PASS (skill, connector, plugin install/off/on/update/uninstall with 7 spellings refused, folder picker, schedule, custom provider, permission rule, model filter, default mode via the iframe bridge; plain HTTP write still 403). Control run on 8b49c55 reproduces the bug. Gate 9 of 9, e2e 270/270 (Chief) at 975970a.
