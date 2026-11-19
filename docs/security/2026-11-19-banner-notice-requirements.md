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
