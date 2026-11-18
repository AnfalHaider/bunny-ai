---
piece: device-full
role: security
sha: 3d1cde0
verdict: PASS
date: 2026-11-18
---

# DEVICE-FULL (v0.1.13, HIGH) at 3d1cde0 (server side, from main e9e84fa): Security PASS, with three things required before release

The owner's go is in `docs/plans/2026-11-18-v0.1.13-plan.md`: "Everything. And enabled through settings / device added." Design's drawing is awaiting the owner's approval.

Read: the whole diff of `src/server/app.js` and `src/server/remoteAccess.js`. Tests from a copy of 3d1cde0, with `NoDefaultCurrentDirectoryInExePath` unset: `remote-access` 40 of 40 and `window-only` 16 of 16 (the 56 Builder A reported).

## (1) No device can raise its own level or another's: holds

- **The only route that sets a level** is `PATCH /api/remote/devices/<id>/level`. It is window-only (`windowOnly()`, and `/api/remote(/.*)?` is in the window-only route list) and accepts only `chats` or `everything`.
- **A Chats device** never reaches it. `remotePolicy` has nothing under `/api/remote` except self sign-out and `/me`, and `isWindowOnlyRoute` refuses it again.
- **An Everything device** is refused three times: `remoteRoute` checks `isRemoteAdminPath(path)` on the decoded path, `route()` repeats that check, and `windowOnly()` refuses `/api/remote*` for `req.bunnyDevice`.
- **No other way in.** No body field, setting or other route writes `session.level`; only `remote.setLevel` does, and only that route calls it. The level lives on the device's session, so a new sign-in always starts at Chats.
- **R-DF3 (LOW, required with a test):** `windowOnly()` tests `isRemoteAdminPath` on the raw `req.url`, but the routes match the decoded path. `PATCH /api/%72emote/devices/<id>/level` therefore passes `windowOnly()`. It is still stopped by `remoteRoute` and by the check in `route()`, both of which use the decoded path, so nothing can be exploited today. But `windowOnly()` should test the same decoded path, and a test should send the encoded spelling.

## (2) Treated as the window, but no launch token, and the cookie and CSRF are still required: holds

- **The order in `remoteRoute`** is unchanged. First the exact Host, the Origin and Sec-Fetch-Site; then the signed-in cookie (no session means the sign-in page only); then the CSRF check on **every** write. Only after all of that comes the `session.level === 'everything'` branch, which sets `req.bunnyDevice` and calls `route()`.
- **`route()` skips the request guard** (token, Host) only for `req.bunnyRemote` or `req.bunnyDevice`, both of which the LAN server set after those checks. A request to 127.0.0.1 can't set either.
- **The page injection** gives an Everything device its session's CSRF value and `remote.js`, never `<meta name="bunny-token">`. No route returns the launch token or the window-only secret.

## (3) The level ends: holds

The level is a field of the in-memory session, so it disappears with the session:
- on sign-out (the device's own, the window's per-device sign-out, or "Sign out all");
- when device access is turned off (`disable()` clears every session);
- after 2 hours idle (`sweep()`, on a timer and before every list or count);
- when Bunny restarts.

An Everything device's Auto chats go back to Ask when it ends, using `remoteAuto` as for Chats devices.

**What does not end:** anything the device already started or changed. Processes it launched keep running, and settings, rules, connectors, installs and files it changed stay changed. A device with "everything" can run commands as the person, so it can also leave something behind that outlives its session. The warning has to say this (R-DF1).

## (4) The plain-HTTP risk with Everything

Before, a stolen device session meant chats with a limited set of tools. Now it means **full control of this PC as the person**: commands, the screen, settings, connectors and installs, the Google client secret in `/api/settings`, and anything a command can reach. The connection is plain HTTP on the LAN, so anyone who can see the traffic can copy the cookie or the passcode.

**R-DF1 (required):** the screen where Everything is given, and the device list while one has it, must say plainly, at least:

> "Everything lets this device do anything you can do on this PC: run programs, change settings, read your files and saved keys. The connection is not encrypted, so on a network you don't fully trust, someone could take over this device's access. Give it only on your own home network, to a device you own. Signing the device out stops it, but does not undo what it already did."

Also recommended:
- Everything ends sooner when idle than Chats does (for example after 30 minutes).
- The window's status line names the device that has it ("Open to other devices · Phone has Everything").

## (5) Audit (R-DF2, required before release)

The only defence against a stolen Everything session is noticing it and signing the device out. So an Everything device's actions must be recorded where the person can see them in the window. A minimal **action log per device**:
- **What gets an entry:** the time, the device's id and name, and what was done. That covers every tool call (the tool's name, not its arguments, which may hold secrets), every window-only write (route and method, not the body), and every sign-in and level change.
- **Where it lives:** under the data folder, readable in the window next to the device list, never through `/api/remote*`, and not readable or writable by a device.
- **Size:** the last 500 entries or 30 days, whichever is smaller.

This is the piece of Design's suggestion I need. Notifications on the window for each window-only write by a device are recommended.

## Verdict

**PASS for the server side at 3d1cde0:** levels can't be raised from a device, Everything gets no launch token, the cookie and CSRF are still required on every write, and the level ends with its session.

**v0.1.13 needs R-DF1, R-DF2 and R-DF3 before Security signs the release.** I'll check them on the candidate.
