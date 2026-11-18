# DEVICE-FULL: check of bf9f320 (builds 5bebbdf + pictures) against drawing version 5 (5ac9440)

Design, 2026-11-18. Verdict on the visible parts: **PASS, with two small notes** (below). Sign-off for release-0.1.13 waits for the sha main will carry.

How shot: `git archive bf9f320`, invented profile (temp data folder, `BUNNY_FAKE_UPSTREAM`), the real server and the real device sign-in over a second address (127.0.0.2), Bunny's window stood in for by a proxy that adds the window's secret. Two devices signed in with the real passcode form (an iPhone-type and an Android-type). Not the made-up server of Builder A's e2e: these pictures are what the real server answered. Light and dark; window 1100 px, device 390 px phone and 1100 px.

Matches the drawing (text read from the page):
- First sign-in dialog: "... signed in. What may it do?", "It works as Chats right now...", Chats the default and chosen, Everything shows Security's warning word for word plus the 30-minute sentence, the button changes to "Give Everything", nothing is given by choosing (the level stayed Chats until the button).
- Devices list: level pill, "Ends after 30 min idle" on the Everything device only, Change / Activity / Sign out, the warning stays on screen while any device has Everything; the status line names the device ("... has Everything").
- Activity: newest first, names only, window-only note, and the limit callout under the list, wording exactly as drawn ("unless one set out to hide it..."). Level change in red.
- Device view: a line under the top ("Everything access · ends after 30 min idle..." in red; "Chats access · the PC can give this device more"). The device is refused /api/remote, /api/remote/log and the encoded /api/%72emote/log (403 each).

Notes (neither blocks):
1. The device's top line at Everything adds "· same as the PC's window" to the drawn "Everything access · ends after 30 min idle". On a phone it wraps to two lines. Accept or shorten.
2. While no device has Everything, the window's top bar reads "Open to other devices · 1 signed in ·" with a dangling "·" at the end (also in Builder A's own picture). Cosmetic: drop the trailing separator.

Not covered: the real Electron window, a real phone, a device idling out after 30 real minutes (only the text is checked here; the timer is Builder A's test), the Windows firewall prompt. The dark pass did not show the first sign-in dialog again because the light pass had already answered it (as designed).
