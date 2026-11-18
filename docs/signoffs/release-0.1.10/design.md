---
piece: release-0.1.10
role: design
sha: 975970a
verdict: PASS
date: 2026-11-18
---

Moved from 9d4e942. 0e5bc55 is server only (sign-in lockout); 975970a changes browser-mode.js and api.js only (a device may answer its own chat's cards; the rules lock re-applies after a redraw): read from the diff, no UI shown to the person changes. Pieces: model-chip 7086583, browser 4d2a894 plus 564b28b. Not re-shot at 975970a; QA walked it 80/80.
