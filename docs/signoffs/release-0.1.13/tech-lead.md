---
piece: release-0.1.13
role: tech-lead
sha: 371b4b4
verdict: PASS
date: 2026-11-18
---

Re-sign on 371b4b4: 43ced06..371b4b4 is linear, 7 commits, no merges, after my PASS at 43ced06 (347bc70). The code changes are UI only, with no server, IPC, route or guard change. device-access.js gives Give Everything the btn bad class (red outline on the surface colour) and Keep Chats btn pri. The Quick ask bar has a cardKind (settings or chat): a problem card hides the footer, and the keys line matches what the card allows; event 'none' sets chatReady false, so Ctrl+Enter opens nothing. settings.html tracks saves in flight in window.bunnyPendingSaves, and closeSettings waits for them (allSettled, 4 s at most) before it removes the frame, which fixes a lost save; it also sets data-settings-filled when the controls are filled. The e2e files wait for that and for the saved value before they choose. app.css and docs/design are unchanged. device-access, quick-ask and quick-ask-redesign pass 30/30 in a scratch copy. The gate re-run after the audit-step network failure is the Chief's; not run by me.
