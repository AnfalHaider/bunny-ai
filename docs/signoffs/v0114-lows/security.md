---
piece: v0114-lows
role: security
sha: e66574b
verdict: PASS
date: 2026-11-18
---

# v0.1.14 Builder C LOWs, e66574b (START-WAIT, PREFS-OWN): PASS

Branch claude/builder-c-v0114-lows. I read the diff. On an extract of e66574b with an invented profile, `start-wait-prefs-own` and `remote-stay` pass 16 of 16.

- **PREFS-OWN.** `prefs:set` now refuses unless `fromOwnFrame(event, isOwn)`, which wraps `isOwn` and returns false on any error. This closes the note from my FONTS/THEME review. `prefs:get` is still unchecked. It returns preferences and the browser address, nothing secret, so this is a note only.
- **START-WAIT.** The window no longer waits for `resumeOpenToDevices()`, which runs at the same time. RS-5 still holds:
  - the banner and tray text follow the real state (the page asks `/api/remote` every second for 15 s, then every 10 s);
  - the tray tooltip is synced when the resume ends and every 5 s;
  - nothing says "open" before it is. At most there is about a 1 s gap before the banner appears.
- **The comment in remoteAccess.js** now matches REMOTE-STAY.

**SW-1 (LOW, not blocking): resume racing the switch.** The window now exists while `resumeRemote()` waits on the network lookup (up to 5 s). `resumeRemote()` reads `remote-state.json` before that wait and doesn't read it again before `openLan`. If the person turns access on or off in Settings during those seconds, the resume can open it afterwards anyway, against RS-6's "off stays off". This needs action within 5 s of start, so it's unlikely, but it's a regression. Fix: after the lookup, re-read the saved state and give up unless it still says on, or run `resumeRemote` and `remoteSet` one at a time through a shared promise. Add a test.

Verdict: PASS at e66574b, with SW-1 for the next build.
