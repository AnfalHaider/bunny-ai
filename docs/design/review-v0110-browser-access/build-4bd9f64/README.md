# BROWSER: build 4bd9f64 against the drawing (5d50d8b)

Design, 2026-11-18. Verdict: **FAIL** on one item (locked controls can still be clicked); everything else matches or differs only in small, accepted ways.

How checked: build `4bd9f64` (branch `claude/builder-a-browser`: 516aa43 this PC, then step 2) extracted with `git archive` and run on an invented profile (temp data folder, fake upstream, own port) from a small launcher that sets the window-only lock on and the "other devices" address to `127.0.0.2` (a loopback alias, so no real firewall prompt and nothing on the real network). A stand-in for the desktop bridge forwarded the window-only writes with the admin secret, as Bunny's main process does; the Settings flow was clicked through by a script, not only read. The Windows firewall dialog and the real LAN address are not covered. Pictures and readings: this folder, `log.txt`, `log2.txt`.

## Matches the drawing
- **Settings → Desktop app → "Use Bunny in a browser"** (group appears only in the desktop window): Open in your browser (button calls the bridge), Keep the same address after restart (off), Allow other devices to open Bunny (off, "off again every time Bunny starts, local network only, never forward a router port").
- **Turn-on flow:** toggling opens the plain warning and a passcode field; a 5-character passcode is refused ("The passcode needs at least 12 characters."); a valid one turns it on: the toggle shows on, "Open to other devices · 0 signed in", the address ("On your network, open http://…/ in a browser and sign in with the passcode. Bunny has to stay running on this computer."), "No device is signed in." and Sign out all devices.
- **Signed-in devices:** after a device signs in the list shows it (label, address, time) with a Sign out; pressing it ends that device's session at once (the device's next request is answered 401).
- **Status line** across the top of Bunny's window: "Open to other devices · 1 signed in · Turn off", in the warning colour, light and dark.
- **Sign-in page** (phone width, light and dark): Bunny AI, a passcode box, Sign in; a wrong passcode says "That passcode is not right."; repeated wrong tries show "Wait 30 seconds and try again." with a countdown and the button disabled. After the right passcode the device gets a cookie that is HttpOnly and SameSite=Strict and lands in Bunny.
- **On a device:** a window-only write (adding a connector) is answered 403 "Change this in Bunny's window."; Settings pages open with a note that anything changing what Bunny may do or run is locked.
- **"Bunny is not running"** page: shown when the server goes away while a page is open (light desktop and dark phone): "Bunny is not running" with a plain explanation (open Bunny, or turn on Keep running in the tray), and it comes back by itself.

## Differences from the drawing
**Must fix (the FAIL):**
1. **Window-only controls are not locked in the browser.** The drawing shows them greyed, with "Change this in Bunny's window." beside each, and not clickable. In the build there is one note across the top of the page, and the controls stay active: choosing "Plan" in Default permission mode changes the select to Plan on screen (`browser-settings-code-tried-light.png`) while the server refuses it, so the page shows a state that was not saved. Fix: disable these controls in browser mode (or put the value back and show the sentence next to the control that was tried). The same for Connectors, plugins and skills, updates.

**Small, to fix when convenient:**
2. The passcode box in the turn-on panel is about 170 px wide and its placeholder is cut off ("Choose a passcode (12 or"). It should be the width of the panel (the CSS asks for 420 px).
3. The signed-in devices list and its buttons are centred; the drawing has them left-aligned, device name on the left, Sign out on the right, with the device name on its own line above the details.
4. The top note in browser mode runs to the page edges with no padding or margin (the same class of problem as the L-1 audit).

**Accepted (owner or Security decisions, or reasonable simplifications):**
5. The warning text is much longer than drawn (Security's plain-HTTP wording) and sits in one inline panel with the passcode, not in two separate dialogs. Devices get full chats except computer control, installs and connectors, as decided.
6. The wrong-passcode message has no "3 tries left" count; it says "That passcode is not right." The wait is 30 seconds with a countdown, not "5 minutes".
7. The sign-in page has no Bunny mark and no "this page is on your own network" line.
8. The Open in your browser row does not show the address; the button is labelled "Open in your browser", not "Open".
9. "Bunny is not running" has no Reload button (it reloads itself).

Not covered: the real Electron window, the real browser launch, the Windows firewall dialog, a real network address, the tray menu item, and the "Keep the same address after restart" behaviour across a real restart.
