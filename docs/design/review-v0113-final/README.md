# v0.1.13 candidate 43ced06: Design's check against the approved drawings

Design, 2026-11-18. Verdict **PASS with notes** (written to docs/signoffs/release-0.1.13/design.md on claude/design-signoff-0113).

How: `git archive 43ced06`; the real server on an invented profile (temp data folder, BUNNY_FAKE_UPSTREAM) with a real device sign-in over a second address; Settings pages loaded one tab at a time (embed=1&section=...) at 1100 px and 390 px; the Quick ask bar's own page (electron/quick-ask/bar.html) run at 640 px with a stand-in for the bridge (`scripts/check-bar.cjs`). Light and dark. Measurements in `log.txt`, tab contents in `tabs-light.json`, a selection of pictures in `shots/`.

Differences from the drawings, sent to the Chief at once:
1. DEVICE-FULL first sign-in: "Give Everything" is a dark filled button; the approved drawing had it red-outlined.
2. Quick ask error states also show the follow-up field and "Open in Bunny", and the keys line says Ctrl+Enter opens the chat even on "no model connected".
3. No "Copied" confirmation seen after Copy in the headless run (clipboard may be refused there): unknown.

Not covered: the real Electron window (click-away, high DPI, second monitor), real acrylic (not used), a real phone, the 30-minute idle timer, scrolling up during a streaming answer, the REMOTE-STAY reopen at start (text read only), fonts on a signed-in phone (files served; not checked).
