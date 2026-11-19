---
piece: release-0.1.13
role: chief-of-staff
sha: 07d6d2f
verdict: PASS
date: 2026-11-19
---

Chief of Staff, 2026-11-19. v0.1.13 = main e9e84fa (v0.1.12) plus:
- DEVICE-FULL: access levels per device, set only from Bunny's window, Activity, the setting-change notice, the red "Give Everything";
- PRIV-2 (invented profiles never read the OS user name);
- REMOTE-STAY: "Allow other devices" stays on after a restart, with Security's RS-1 to RS-6;
- the Settings fixes: tabs show only their own section, desktop preferences are kept (applyTrayRule), the address is kept from the moment it is turned on, the six approved moves, Verbose step results, changes saved before Settings closes;
- CHAT-SWITCH (chats open without a reload);
- 13 bundled OFL fonts and THEME-APPLY;
- the Quick ask redesign (13 approved changes), its error states, and QUICK-CLIP (error cards no longer clipped);
- the version, 0.1.13.

Evidence: gate 9/9 at 07d6d2f (docs/releases/evidence/2026-11-19-v0-1-13-gate-07d6d2f.md). Security PASS at 371b4b4, with every piece it reviewed earlier carried in. Design PASS at 371b4b4 against the approved drawings. QA PASS at 07d6d2f (real-window error cards, 6/6 at scale 1 and 2), after its full walk at 43ced06 and 371b4b4. Tech Lead and Librarian PASS at 07d6d2f.

By the owner's word ("just run the test for cut part, then release and push, no need for all the tests and sign offs again"), the last fix was checked with its own tests and QA's real-window run. The full gate was still run on 07d6d2f and passed.

Not tested for real: the OS notification toast, the real start-at-sign-in entry, Ctrl+Alt+Space on a PC where it is free, "Allow other devices" opened on a real home network, a real phone, and the 30-minute idle timer.
