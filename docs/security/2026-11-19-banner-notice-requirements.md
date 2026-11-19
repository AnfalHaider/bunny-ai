# BANNER-NOTICE (v0.1.14): what may be dismissed, and what must stay findable

The owner wants two banners to be dismissable, and only a notification:
- the "Open to other devices / signed in / has Everything" banner in Bunny's window;
- the level line on a device's own page.

(Relayed by the Chief of Staff, 2026-11-19. The exact words are in the v0.1.14 wish list.)

This relaxes two earlier rules:
- RS-5 (the open state visible from the first moment);
- R-DF1 (Everything is never hidden).

The principle: **the notice may go away, but the state never disappears.** Someone looking at Bunny's window can always tell, without opening anything, that it is open to other devices, and whether any device has Everything.

## BN-1: what may be dismissed

- The window's banner, with an × (or Esc while it has focus).
- The device page's level line, on that page.
- When the banner only says "Open to other devices · N signed in" (no device at Everything), it may also hide by itself after a short time (Design's choice, for example 10 s). The states in BN-3 never hide by themselves: the person dismisses them.

## BN-2: what stays, and can't be dismissed

**In Bunny's window**, a small status chip in the window's own top bar or sidebar. It's always there while access is open:
- `Open to devices · N` in the normal colour;
- **in the warning colour with words, not colour alone,** while any device has Everything: `<device> has Everything` (or `Everything: 2 devices`);
- a click opens the banner again, or Settings → Use Bunny in a browser.

The chip is `role="status"` and readable by a screen reader. It shows from the first moment access is open, so RS-5 now applies to the chip. The window polls once a second for the first 15 s, as START-WAIT does now.

**Also, as today:**
- the tray tooltip "Bunny AI: Open to other devices";
- the one-time notification at start;
- in Settings, R-DF1's red warning box in the device list while any device has Everything;
- the warning in the Give Everything dialog.

None of these can be dismissed.

**On a device's page at Everything:** a small chip in the page's own header reading `Everything`, in the warning colour. It stays after the line is dismissed. The person holding that device must always be able to see it has full control: a phone gets passed around. At Chats, the line may be dismissed with nothing left behind.

## BN-3: the notice comes back on its own

The banner comes back, even after it was dismissed, when:
- a device signs in;
- any device is raised to Everything (as the first sign-in dialog does now);
- access is turned on, or reopened at start (REMOTE-STAY);
- the window starts or reloads (see BN-4).

**The setting-change notice** (d46888a: `<device> changed a setting`) is its own notice:
- dismissing the banner never suppresses it;
- it never hides by itself;
- it appears for every new change, as now.

## BN-4: dismissing is never remembered

- A dismissal lives only in that page's memory. It isn't saved in a setting, `localStorage`, a cookie, or any file.
- A restart or a reload of the window brings the banner back. A new page load on a device brings its line back.
- **This is required, not a style choice.** If a dismissal were stored on the server (a setting), a device at Everything could set it and hide from the person at the PC that devices are connected. A device can change settings at Everything, and no route may let a device change what Bunny's window shows about devices.

## BN-5: what doesn't change

- Nothing changes on the server: no new route, no new setting, and `/api/remote*` stays refused to every device.
- The words in R-DF1's warning, the Give Everything dialog, Activity, and the idle limits (30 minutes at Everything) are unchanged.
- The device page still reloads when the window changes its level. Its new line and chip show the new level.

## Tests Security will look for

- With access open, dismiss the banner: the chip shows `Open to devices · N`. Raise a device to Everything: the banner returns and the chip turns to the warning colour with the device's name. Dismiss again: the chip stays.
- A device signs in after a dismissal: the banner returns.
- Reload or restart after a dismissal: the banner is back. Nothing about the dismissal is found in settings, `localStorage` or the data folder.
- A device at Everything changes a setting after the banner was dismissed: the setting-change notice appears.
- A device page at Everything: dismiss the line, and the `Everything` chip stays.
- Both themes, phone and desktop widths. The chip is never hidden by the narrow layout.

## Revision after the owner's decision (2026-11-19): no banner anywhere, the chip carries everything

The owner's words, relayed by the Chief of Staff (main records it):

> "No banner on top is required."

Asked where: "Everywhere".

So there's no devices notice or banner in Bunny's window, on a device's page, or in a browser page on the PC. This **replaces BN-1** (dismissable notices) **and BN-3** (the returning notice). Unchanged: BN-2 (the chip that can't be dismissed), BN-4 (nothing about it is stored) and BN-5 (no server change). The chip now has to do the notice's job.

### BN-6: what the chip shows, always

Every Bunny page on the PC (the window, and Bunny opened in a browser on this PC) shows the chip in its top bar for as long as device access is open. On a narrow width it shortens its words, but it never disappears.

| State | Chip |
|---|---|
| Open, no device at Everything | `Open to devices · N` (normal colour) |
| Any device at Everything | warning colour, in words: `Pixel 8 has Everything` / `Everything: 2 devices` |
| The internet route is on (OPEN-SIGNIN) | warning colour: `Open to the internet · N` (combined with Everything when both apply) |

It's `role="status"`, with the full words in `aria-label`, never colour alone.

### BN-7: new events make the chip say what happened, until it's clicked

Something new happens while the page is open when:
- a device signs in (compared by device id, not count; this closes BN-L1);
- a device is raised to Everything;
- the internet route reopens at start;
- a device changes a setting (see BN-8).

For each, the chip **switches to the event's words**, for example `New: Pixel 8 signed in` or `Pixel 8 changed a setting`. It shows a small count badge when more than one event is waiting, and is **announced once** through `aria-live="polite"`.

- **A short pulse is allowed**, but never as the only sign, and none with reduced motion.
- **It doesn't go back by itself on a timer.** It goes back to the state words (BN-6) only when the person clicks it. The click opens the devices list in Settings, or that device's Activity for a setting change.
- **It's never stored (BN-4):** a reload shows the state words, and Activity keeps the history.

### BN-8: "<device> changed a setting" becomes a chip event

The separate bottom-right notice from DEVICE-FULL is removed, because it's a banner under the owner's word. It becomes a BN-7 event:
- the chip turns to the warning colour with `Pixel 8 changed a setting`;
- clicking opens that device's Activity;
- it's never cleared by time;
- when several changes wait, the badge counts them.

This keeps R-DF2's purpose (the person at the PC notices a change made from a device) without a notice.

### BN-9: on a device's own page

- No notice at all.
- At Everything, the red `Everything` chip in the page's header stays (BN-2) and can't be dismissed.
- At Chats, nothing is shown.

### What's not a banner, and stays

- The tray tooltip mirrors the chip, including the newest event's words.
- The one-time start notification (RS-5) is Windows' own, not a banner in Bunny. It stays, to say access reopened while Bunny may be hidden in the tray.
- **The first-sign-in dialog ("What may it do?") stays.** It's the place where Everything is granted with R-DF1's warning, not a banner. If the owner wants it gone too, that's a separate question, because without it the window would grant levels only from Settings.
- R-DF1's box in Settings and the Give Everything warning stay.

### Tests Security will look for (replacing BN-1 and BN-3's)

- **No banner:** no `#remote-note`, `#device-note` or `#device-notice` element in the window, a browser page or a device page, in any state.
- **New sign-in:** the chip reads `New: <device> signed in` and stays until clicked. The click opens the devices list. After a reload it reads the state words.
- **The swap case:** a sign-out and a sign-in between two looks (BN-L1) still produce the event.
- **Raise to Everything:** the chip goes to the warning colour with the device's name.
- **A setting changed from a device:** the chip shows the event, and the click opens Activity. Two changes show a badge of 2.
- **Reduced motion:** no pulse. The `aria-live` announcement still happens once per event.
- **Device page:** the Everything chip at Everything, nothing at Chats.
