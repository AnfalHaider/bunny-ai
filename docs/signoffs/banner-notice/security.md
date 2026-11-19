---
piece: banner-notice
role: security
sha: 47d0951
verdict: PASS
date: 2026-11-19
---

# BANNER-NOTICE, 47d0951 (+ pictures 67f761d) (Security): PASS against BN-1 to BN-5

Branch claude/builder-a-banner-notice, from main 017a514. I read:
- `src/ui/remote-notice.js`;
- the `watchRemote` part of `src/ui/chat.js`;
- `src/ui/remote.js` and `app.css`.

`git diff --stat 017a514 47d0951 -- src/server electron` is empty: no server or shell file changed. `test/remote-notice.test.js` passes 5 of 5 on an extract. I didn't run the e2e (32 cases), because a gate was running on this PC.

- **BN-1, what may be dismissed:**
  - The window's notice closes with × or Esc. Only the plain "Open · N" notice hides by itself (10 s), and only when no device has Everything (`autoHide = every.length === 0`).
  - A notice that turns to Everything while open is redrawn without the auto-hide.
  - On the device page, the notice closes with × or Esc.
- **BN-2, what stays:**
  - **Window:** `#remote-chip` sits in `.topbar` for as long as `status.enabled` is true. It reads "Open to devices · N", or in the warning colour **with words**: "<label> has Everything" or "Everything: N devices". It's `role="status"` with an `aria-label`.
  - **Narrow windows** switch to the short words. The CSS hides only the long words, never the chip.
  - **A click** brings the notice back.
  - **Device page at Everything:** a red "Everything" chip goes in the header, or fixed at the top right if there's no header. It's removed only when the level isn't Everything. At Chats, nothing is left behind.
  - The tray, the start notification, R-DF1's Settings box and the Give Everything warning aren't touched.
- **BN-3, when it comes back:** `bannerReturns` brings it back on:
  - the first look (start or reload);
  - access turned on or reopened;
  - more devices signed in;
  - a device id that is newly at Everything.

  The `<device> changed a setting` notice (`settingNotice`) is unchanged and separate.
- **BN-4, nothing stored:** a dismissal lives only in page variables (`noteOpen` in the window, `dismissed` on the device). These files contain no `localStorage`, `sessionStorage` or cookie code (`git grep`). A device page's dismissal resets on every page load, including the reload a level change causes.
- **BN-5, nothing new on the server:** no route and no setting. "Back to Chats" and "Turn off" on the window's notice use the existing window-only routes.
- **Text only:** every label and device name is set with `textContent`. The old `innerHTML` glyphs in `remote.js` are gone.

**BN-L1 (LOW, not blocking):** `bannerReturns` notices a new sign-in only when the **count** of signed-in devices goes up. If one device signs out and another signs in between two looks (10 s after the first 15 s), the count stays the same and the notice doesn't come back. The chip still shows the state, and the first-sign-in dialog still asks about the new device. Fix later by comparing device ids, as for Everything.

Verdict: PASS at 47d0951 (pictures 67f761d).
