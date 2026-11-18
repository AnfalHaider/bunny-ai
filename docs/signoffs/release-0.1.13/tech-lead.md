---
piece: release-0.1.13
role: tech-lead
sha: 07d6d2f
verdict: PASS
date: 2026-11-18
---

Re-stamp on 07d6d2f, one commit on 371b4b4, which I signed in 2ddff05. Only this diff was read, per the owner's words relayed by the Chief: just run the test for the cut part. electron/quick-ask/bar.js: every focus() now passes preventScroll, so a focus never scrolls the overflow-hidden page while the window is still short; unscroll() puts the page back at the top before fit() measures and on any captured scroll. It resets only window and body scroll, so the answer pane's own scrolling is untouched. There is no IPC, preload, CSP or server change. The e2e adds a check per card state (the Chief's run). node --check passes on bar.js; quick-ask and quick-ask-redesign unit tests pass 25/25 in a scratch copy. Nit, not blocking: the NOSCROLL and unscroll lines were placed between fit()'s doc comment and fit().
