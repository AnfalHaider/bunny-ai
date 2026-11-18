---
piece: release-0.1.13
role: librarian
sha: 371b4b4
verdict: FAIL
date: 2026-11-18
---

Librarian: FAIL at 371b4b4 on pictures and help. PRIV passes: the new Give Everything, first sign-in, notice, Activity and Quick ask pictures I opened (first-signin-everything-light, device-everything-dark, notice-light, offline-light, no-model-dark, needs-window-light) use the invented profile (Sam, Sam's phone, Kitchen laptop); no real name or OS user name. Help copy is unchanged where it should be (device-access.js only restyles Give Everything and Not now; the 30 min idle copy still matches EVERYTHING_IDLE_MS). FAIL: three quick-ask error pictures do not match the code. The code (electron/quick-ask/bar.js:265-298, 330-332) hides the follow-up row and its second Open in Bunny in problem states, and sets the footer hint to Esc closes for no-model and Ctrl+Enter opens it in Bunny for needs-window. offline-light.png and no-model-dark.png still show the follow-up box and the footer hint Enter sends a follow-up, and needs-window-light.png shows the follow-up box too. The pictures need rebuilding from 371b4b4 before PASS. Gate: not seen by Librarian; no gate evidence file for 371b4b4 yet.
