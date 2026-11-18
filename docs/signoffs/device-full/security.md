---
piece: device-full
role: security
sha: 55181f1
verdict: FAIL
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

## Re-review at 55181f1 (R-DF2, R-DF3, the 30-minute idle): FAIL, the action log loses its history on a restart

**R-DF3 fixed.** `windowOnly()` now tests the decoded path for `req.bunnyDevice`, and a path that can't be decoded is refused. Tested with the encoded spellings.

**The 30-minute idle limit is in.** `idleLimit(s)` gives `EVERYTHING_IDLE_MS` (30 minutes) to an Everything session and 2 hours to Chats. It applies in both `sweep()` and `sessionFor`, and a level change resets the idle clock.

**R-DF2, the log, holds in content and access:**
- An entry is the time, the device's id, name and level, and `kind`, `tool`, `method`, `path`, `level` and `from` only, each cut to 200 characters. There are no arguments and no bodies.
- Tool calls are logged in `runTool` for `req.bunnyRemote` and `req.bunnyDevice`, so helper chats count too. Window-only writes are logged as route and method. Sign-ins, idle sign-outs and level changes are logged as well.
- `GET /api/remote/log` is window-only, and devices are refused anything under `/api/remote*`.

**But the log is not kept across a restart.** `logAction` writes the in-memory list to `remote-actions.json` before the saved file was ever read. The saved file is loaded only when the window reads the log (`actions()`). My probe `docs/security/device-full-probe/log-restart.mjs`, with invented data in a temp folder, wrote an earlier entry, made a fresh `createRemoteAccess` (a restart) and logged one action:

```
entries on disk after a restart and one new action: 1; the earlier entry is LOST
what the window then reads: 2 entries (New device, New device)
```

So the first action after every restart erases the history (for example, last night's actions by a stolen session). The window then shows the new entry twice: `loadActions` adds the saved file, which now holds it, to the copy in memory.

**Fix:** load the saved log before the first write. For example, start `loadActions()` when the module is created and chain every save after it, or `await loadActions()` inside the save chain before writing, and stop concatenating the in-memory entries onto a file that already holds them. Test it with a probe like mine: an entry written by an earlier run, a restart, one new action, and the earlier entry still there, with no duplicates.

**Limit to state honestly (not a code fix):** an Everything device can run commands, so it can edit `remote-actions.json` itself. The log shows what a device did unless that device set out to hide it. The window's Activity view should not claim more than that.

**Still required for release:** R-DF1, the visible warning, the named status line and the Activity view, which come with the drawing.
