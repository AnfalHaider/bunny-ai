---
piece: release-0.1.10
role: qa
sha: 975970a
verdict: PASS
date: 2026-11-18
---

Re-walk on 975970a (F-1, F-2 fixes), light: e2e/w0110-walk.mjs 80 of 80 on an invented profile. F-1 fixed: a device presses Allow in the real page, POST permission 200, note.txt written on this computer, model answers; the page's sendJSON now sends the request (server answers permission.gone for a fake card id). A device sets its chat to Plan mode from the menu in the real page (server has plan, no refusal sentence) and back to Manual/ask. F-2 fixed: rules Pattern box and Add rule natively disabled in a tab at desktop+phone, light+dark; typing saves nothing. Device still cannot change settings, remote, skills, connectors (403 sentence); sign-in wrong/wait/Sign out/status unchanged. Earlier at 0e5bc55: RA-1 6 of 6, settings-bridge 25 of 25, e2e/w0110-electron.mjs 24 of 24 (artifact Open/Print, model chip, W2-9, About notes, updater). Not re-run on 975970a: the real-Electron walks (the change is page JS for device pages and the rules lock, not the window path); re-stamp to the final sha on the Chief's word.
