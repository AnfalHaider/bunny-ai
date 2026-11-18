---
piece: release-0.1.13
role: security
sha: 371b4b4
verdict: PASS
date: 2026-11-18
---

# release-0.1.13 Security review: PASS at 43ced06

The candidate is 43ced06 on claude/builder-a-v0113-final. It runs linearly from 0603d13 (the v0.1.13 plan) and the Chief of Staff reports gate 9/9. The owner's release word was relayed by the Chief: "Yes, release when ready", 2026-11-18. The mapping of signed pieces to the candidate is in `release-0.1.13-check/README.md`.

## Signed earlier and found unchanged in the candidate

| Piece | Sign-off |
|---|---|
| DEVICE-FULL | PASS at f7caeb4 (5d02330) |
| REMOTE-STAY | PASS at 0fc5f75 (f60f0b5) |
| FONTS | PASS at 9dcf0a0 (97fcf3d), in the candidate as de6a8cd, same patch-id |
| THEME-APPLY | PASS at 35fdb6a (97fcf3d), in the candidate as 1b43ec2, same added and removed lines |
| Quick ask Esc | PASS at cc2bc3e (cb3b918) |
| Quick ask theme and fonts | PASS at 43ced06 (cb3b918) |

## Read for this release

- **74b6da9, "Keep the same address" keeps the port at once.**
  - `portToKeepNow` saves the window's current 127.0.0.1 port into `fixedPort` when the switch turns on.
  - The device listener already reuses that port.
  - No new listener or address appears.
- **911ec51, Settings rows move between tabs.**
  - UI only: no wording or control changed.
  - The sidebar is redrawn when Settings closes.
- **21e0cb8 and f99a67c, Verbose shows the saved longer step result.**
  - `stepResultText` picks the saved `modelResult` (at most 8,000 characters) over `result` only in Verbose, and renders it with `textContent`.
  - The server is unchanged. `modelResult` is already in the saved chat and is never kept for a result that looks like a secret or for an incognito chat. No route is added.
  - f99a67c is wording.
- **7caec59, CHAT-SWITCH (cherry-picked from 2fb688a, same patch-id).**
  - Chats open in place with `history.pushState(null, '', './index.html?s=<id>')`.
  - The URL is relative to the page and pushState is same-origin only, so no address can leave Bunny's origin.
  - The ids come from the server's chat list or from `?s=`, which boot already accepted. `popstate` reads `?s=` the same way.
  - Drafts for other chats stay in page memory only.
  - While a reply is streaming, the old full navigation is kept.
- **Read in earlier reviews:**
  - 6c64b90 (tab leak), be9b31b (desktop prefs: the patch is built from a typed allow-list first) and a33f936 (e2e): in the REMOTE-STAY review.
  - e17b971 and a64b527 (Quick ask look and redesign; `quickask:open` 'settings' sits behind `fromBar`): in the Quick ask review.
  - 256a721 is the version bump.

## Open, not blocking, carried to the board

- **DF-L1 (LOW):** device names look alike (system and browser only).
- **DF-L2 (LOW):** only setting changes raise the window notice; other window-only actions show only in Activity.
- **`prefs:set` sender check:** it has no `isOwn` check, unlike its siblings. Unreachable today. Add it for consistency.
- **Connectors from devices** stay denied, pending the owner's choice.

Tests Security ran on extracts with invented profiles:
- remote-access, device-access and priv2-name: 52 of 52 (bf9f320);
- remote-stay, remote-access and browser-access: 62 of 62 (0fc5f75);
- fonts and theme-shell: 7 of 7 (35fdb6a);
- quick-ask and quick-ask-redesign: 25 of 25 (43ced06).

Not run by Security here: the full gate (the Chief reports 9/9). Also not run: the real Electron window with device access on, so as not to open a listener on the owner's network.

Verdict: PASS for release 0.1.13 at 43ced06.

## Re-sign at 371b4b4 (supersedes 43ced06)

371b4b4 on claude/builder-a-v0113-final runs linearly on 43ced06 (`git merge-base --is-ancestor 43ced06 371b4b4`). I read the diff only, because a gate was running. The non-picture code changes are 9 files and 121 lines.

- **a8845c6 and 2439def:** "Give Everything" becomes the red-outlined `btn bad`, "Keep Chats" `btn pri`, "Not now" outlined. Styling only. The dialog's logic, the warning text (R-DF1), and the window-only level route are unchanged.
- **d235050 (from fc263e2):** Quick ask's problem cards fill the panel, hiding the follow-up row. The keys line follows the card. No new bridge call, IPC or data crosses: `openInBunny('settings')` already sits behind `fromBar` (cc2bc3e and 43ced06 review).
- **01f64dc:**
  - The Settings page tracks its saves in flight (`window.bunnyPendingSaves`).
  - `closeSettings` waits for them, at most 4 s, before removing the frame.
  - It reads the set from Bunny's own same-origin frame inside `try`, so another page in the frame has nothing to give.
  - It changes no route and nothing a device can reach.
- **371b4b4:** `data-settings-filled` on the Settings page's root element. A marker only.
- **251d74e and 488de8c:** e2e only.

Nothing in this range touches the server, the device routes, the remote-access code, the preload or IPC handlers, or the CSP.

Verdict: PASS for release 0.1.13 at 371b4b4. The earlier sections' mapping still holds, since every signed piece is an ancestor. The open items carried to the board are unchanged.
