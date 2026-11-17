# BROWSER re-check: build 4d2a894 against the drawing (5d50d8b)

Design, 2026-11-18. Verdict: **PASS** for the five items from the FAIL at 4bd9f64. Two things I could not look at, and two small new differences, are listed below.

How checked: build `4d2a894` (branch `claude/builder-a-browser`) extracted with `git archive`, run on an invented profile from the same launcher as before (window-only lock on, other-device address `127.0.0.2`, desktop-bridge stand-in with the admin secret) plus a small invented scripted model server. Pictures and readings in this folder (`log.txt`).

## Fixed (the earlier list)
1. **Window-only controls locked in a browser: fixed.** On the Code page in a browser tab the permission mode select is disabled and greyed (opacity 0.5), with "Change this in Bunny's window." in its row, and so are 9 of the 11 controls in Permission rules; About, Privacy, Models and Customize also show disabled controls with the sentence (Customize's Add is disabled). Trying to choose Plan does nothing and the value stays "Manual" (it no longer shows an unsaved value). Light and dark, 800 and 390 wide.
2. **Passcode box full width:** 420 px in a 750 px panel (the width the CSS asks for; the placeholder reads in full).
3. **Signed-in devices list left-aligned:** device name and details on the left, Sign out on the right, text-align left.
4. **The top note has padding** (16 px from the sides, 12 px from the top, 768 px wide at 800).
5. **No uncaught error:** no page errors in the window or in browser mode. On a device's Settings page the console shows three refused requests ("403 Forbidden" resource loads); these are refusals, not script errors.

## A real card in a browser tab (the one look Builder A asked for)
Seen for real, not as drawn DOM: on a tab on this PC (phone width, dark) the model asked for Code mode, and the capability card appears in the chat ("Bunny needs a capability", "Code mode: read and change files in a folder, and run commands and programs there", "To read your files"), with both buttons disabled (Choose a folder, Not now) and "Change this in Bunny's window." under them. It reads clearly and fits at 390 wide (`pc-capability-dark.png`).

## Not looked at (UNKNOWN)
- **The question card ("Bunny has a question") on a PC tab and on a device, and the live capability and permission cards on a signed-in device.** I could not make the scripted model answer in those sessions (the page used the built-in offline model, and on a device the model chip cannot be changed, see below), so no question card or device card was seen. Builder A's DOM-drawn e2e is all there is for these.
- The real Electron window, the Windows firewall dialog, a real network address.

## New small differences (not blocking)
- **The lock sentence is squeezed into the composer's under-row in a browser tab on desktop width:** "Change this in Bunny's window." wraps to four lines beside the greyed mode control (`pc-question-light.png`). On a phone it fits on one line. It should be one line, or a tooltip, so the row keeps its height.
- **A device cannot choose a model:** clicking the model chip on a signed-in device shows a red "Change this in Bunny's window." under the composer. The drawing showed the chip as usable on a device. If that is intended (choosing a model is window-only), the chip should look disabled on a device, with the sentence on hover, not an error after a click.
