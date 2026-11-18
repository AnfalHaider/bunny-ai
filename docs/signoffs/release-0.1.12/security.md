---
piece: release-0.1.12
role: security
sha: eba5478
verdict: PASS
date: 2026-11-18
---

eba5478 = main 4cebedc + the WEB-APP commits Security reviewed (patch ids equal to 1e54c93, ee97e26, 447d6c9, 8be0be6, 93a1bce, 6d20c63 at 28c0b00, 4b70431, a802d51, c1274bf, 3bb02e9, 9273cd8) + Version 0.1.12 (version fields only) + 16d9296 (old-worker clear in the background, 3 s timeout, no flag on timeout; read, fine) + eba5478 (one e2e line). No kit, guard, hook or .claude change against main. WEB-APP review: docs/security/2026-11-18-web-app-review.md (f668c8a, claude/security-webapp-0111). Gate 9/9 at eba5478 per the Chief of Staff. LOW: the background clear can briefly let the old worker store the current page (same origin only).
