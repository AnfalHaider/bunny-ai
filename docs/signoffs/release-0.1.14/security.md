---
piece: release-0.1.14
role: security
sha: 5fbb7975
verdict: PASS
date: 2026-11-20
---

Final candidate 5fbb7975 on claude/v0114-integration. Since my PASS at 0870bd2d (ancestor confirmed) the diff 0870bd2d..5fbb7975 touches only tests and docs: test/kit-next-k1.test.js (eb3205a5: 5 s no-hang backstop, reason now asserted on the over-size case, guard.mjs untouched), five e2e files (helpers, pictures spec and scenes, settings-moves, theme-apply: test settings reset to defaults and longer waits for a busy PC, all against the invented test profile), plus the v0.1.14 release notes and plan (docs only). No src, electron, scripts or kit change. Every piece I signed for 0.1.14 is unchanged. The Chief reports the gate 12/12 at this sha (not re-run by me). Known LOWs unchanged and non-blocking: DF-L1/2, BB-4, SP-L1/2, EN-4.
