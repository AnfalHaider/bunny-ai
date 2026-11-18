---
piece: release-0.1.11
role: qa
sha: ea1bd05
verdict: PASS
date: 2026-11-18
---

ea1bd05 = 28812e1 + a docs-only merge (git diff 28812e1 ea1bd05 touches only docs/plans/2026-11-18-v0.1.11-plan.md and docs/plans/2026-11-18-v0.1.12-plan.md, checked by me); walk and gate at 28812e1 (gate 9 of 9, e2e 304/304, Chief). Walk e2e/w0111-walk.mjs on an invented profile, Chromium with a stubbed desktop-window bridge and a real /api/remote (remote on, lanAddress 127.0.0.2): 175 of 175 PASS. With the Open to other devices bar on screen, in Chat and Code mode, at 1280x800, 1050x600 and phones 390, 360, 320, light and dark: the row under the chat box and the sidebar foot are inside the window, no sideways scroll; the chip on Auto reads Auto + model, Auto never clipped; phone chip shows the long name (390: 15+ characters, 360: 12, 320: 6) and never touches Send (closest gap 4 px); + and mic present and inside the row, order +, mic, chip, Send; Send works with the bar on; with remote off the app fills the window. Control run on 975970a (0.1.10) fails 56 rows (row under the box ends at 819 of 800, sidebar foot at 823, Auto clipped). Not run in real Electron (the bar is drawn only in the desktop window; bridge stubbed).
