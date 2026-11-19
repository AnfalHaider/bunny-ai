---
piece: banner-notice
role: security
sha: 05ed44b
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

## Chip-only rebuild, 05ed44b (+ pictures e3cf644): PASS against BN-2, BN-4, BN-5 and BN-6 to BN-9

Commits 25e2a92 (BN-L1, device ids) and 05ed44b, on claude/builder-a-banner-notice. Read with `git diff --ignore-cr-at-eol 67f761d 05ed44b`.

- **No notice anywhere (BN-6, BN-9).**
  - `git grep` over 05ed44b finds no `remote-note`, `device-note`, `device-notice` or `settingNotice` left in `src/ui`.
  - The device page's toast is gone. Its red `Everything` chip stays and can't be dismissed. At Chats, nothing is shown.
- **The chip (BN-6).**
  - It's on every Bunny page on this PC while access is open: the window, and now Bunny in a browser on this PC, since `watchRemote` runs there too.
  - A device page is refused `/api/remote` and stops asking after three refusals.
  - It shows state words, in the warning colour with words at Everything, and shortens without disappearing on narrow widths.
  - It's `role="status"` and `aria-live="polite"`, with its words in `aria-label`.
- **Events (BN-7, BN-8).**
  - `newEvents` brings a sign-in by **device id** (closes BN-L1) and a raise to Everything.
  - A setting change from a device becomes an event read from the window-only log. The bottom-right notice is removed.
  - The newest event's words show, with a count badge when more than one waits. The chip is redrawn only when its words change, so each event is announced once.
  - The pulse is off with reduced motion and is never the only sign.
  - There's no timer. A click clears what waited and opens the devices list, or that device's Activity for a setting change.
  - The first look and access being turned on show the state words, not an event.
- **BN-4, BN-5.** Events live in a page variable (`events`), with no storage code in these files (`git grep`). No server or shell file changed (`git diff --stat … -- src/server electron` is empty).
- **Tests:** `remote-notice` passes 4 of 4 on an extract. I didn't run the e2e, since a gate may be running.

**Still to come, as Builder A said:** the tray mirroring through a new `isOwn` IPC. I'll read it when it lands. "Reopened at start" and the shut-off event belong to OPEN-SIGNIN, and come with it.

**Line endings:** this commit rewrites `src/ui/chat.js`, `src/ui/app.css`, `src/ui/device-access.js` and `src/ui/remote.js` with CRLF. The real change is about 140 lines; without `--ignore-cr-at-eol` it shows as about 15,000. Builder A should restore LF in the next commit, as was done for WEB-ACCESS. It's not a security finding, but it hides real changes from review and blame.

Verdict: PASS at 05ed44b (pictures e3cf644).
