---
piece: d-2
role: security
sha: 9ca3f77
verdict: FAIL
date: 2026-11-16
---

Fixed and re-tested: D2-1 junction leak gone, D2-2 reads 1 MB only, D2-3 caps in place, D2-4 .git and node_modules refused, picker-only mode works when on (typed folders 403, drive root and data folder refused). Still failing: the desktop app does not turn it on, electron/main.js calls createApp with only dataDir and never records the picker result, so D2-5 is open in the real app; and POST /api/schedules and /api/projects still store any folder. See docs/security/2026-11-16-d2-panes-review.md
