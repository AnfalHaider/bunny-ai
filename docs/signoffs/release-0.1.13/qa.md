---
piece: release-0.1.13
role: qa
sha: 07d6d2f
verdict: PASS
date: 2026-11-18
---

PASS at 07d6d2f (371b4b4 + bar.js clipping fix + an e2e test; only electron/quick-ask/bar.js and e2e/quick-ask-redesign.spec.js differ, checked by me with git diff --stat). Real window, e2e/w0113-qerr.mjs: 6 of 6 at scale 1 and 6 of 6 at scale 2. The 500 card ('Bunny could not answer') and the offline card ('You are offline') are no longer clipped: scrollY 0, pill top 8, window 235 and 255 high (as tall as the pill plus margins; before the fix scrollY 10 and 33, pill top -2 and -25, window 224 and 222). No-model card whole (Open Bunny settings opens Providers, Esc closes), Try again with the model back answers, Ctrl+Enter on an error card opens the chat with the question. Quick ask normal-answer walk e2e/w0113-window.mjs 16 of 16 at scale 1 on 07d6d2f. Per the owner's words (relayed by the Chief: just run the test for the cut part, no need for all the tests and sign-offs again) SET-ALL, does-what-it-says and the other walks were NOT re-run at 07d6d2f; their results stand from 371b4b4 (SET-ALL 134 of 141, the 7 being the held Ctrl+Alt+Space on this PC; does 24 of 24; extra 8 of 8; keep-address ports 50018 x3; qprefs 3 of 3) and 43ced06 (v0.1.11 175 of 175, v0.1.12 36 of 36). UNKNOWN: the real OS notification toast, the real open-at-login entry, Ctrl+Alt+Space on a PC where it is free, Allow other devices on a real LAN.
