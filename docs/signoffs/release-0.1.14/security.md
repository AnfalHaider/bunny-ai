---
piece: release-0.1.14
role: security
sha: a579d7e9
verdict: PASS
date: 2026-11-20
---

Final candidate a579d7e9 on claude/v0114-integration. Since 5fbb7975 (my last release PASS): d3e89565 and 5695d62e (Settings Engines layout, Always protected list, phone row CSS) and c457a8cd, d7022bfe (RL-1 wording: the list says file tools only and that commands are not blocked; RL-1 closed), all read; the four list items match floor() in bridge.js and the ER-6 warning text is unchanged. Since d7022bfe (ancestor confirmed) only e2e/search-pc.spec.js (a retrying wait), scripts/gate-marks.mjs and scripts/gate.mjs (which failed-test lines the gate prints; pass or fail is unchanged), and test/gate-marks.test.js. No src, electron or .bootstrap change after d7022bfe. Gate 12/12 at this sha per the Chief (not re-run by me). Known LOWs unchanged and non-blocking: DF-L1/2, BB-4, SP-L1/2, EN-4.
