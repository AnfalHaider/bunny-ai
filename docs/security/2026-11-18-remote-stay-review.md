# REMOTE-STAY review (Security), f7caeb4..6c1a901: FAIL, two fixes needed

Commits on claude/builder-a-v0113-final:
- 6c64b90: tab leak.
- be9b31b: desktop prefs.
- 256a721: version.
- a33f936: tabs e2e.
- 808bad5: REMOTE-STAY.
- 4be7666: pictures.
- 6c1a901: RS-4 fail closed.

The owner's go: "stay after restart" (2026-11-18, recorded on main 2a61229).

Tests on an extract of 6c1a901 with an invented profile (`BUNNY_DATA_DIR` temp, `BUNNY_FAKE_UPSTREAM=1`): `remote-stay`, `remote-access` and `quick-ask` pass 71 of 71.

## Requirements as built

- **RS-1, passcode at rest: met.** `remote-state.json` holds only `{enabled, address, network}`. The scrypt hash and salt stay in `remote-access.json`. Neither `/api/remote` nor the settings return them (test RS-1). Keeping the hash after Turn off is accepted. It is scrypt (N=16384) of a passcode of at least 12 characters, and it lets the person turn access back on without choosing a new one. Choosing a new passcode replaces it.
- **RS-2, sign-ins per start: met.** Sessions are never saved. After a restart every device signs in again, at Chats.
- **RS-3, the try limit after restart: met.** The counters start at zero, but a try is still reserved before scrypt from the first request (test RS-3).
- **RS-4, the network check: NOT met.** See RS4-a and RS4-b.
- **RS-5, visible from the start: met.** The shell awaits `resumeRemote()` before the window loads, so the window's first status read already shows the banner. The tray tooltip reads "Bunny AI: Open to other devices". A one-time notification appears at start, and when Bunny stays closed it says why.
- **RS-6, off is saved: met.** Turn off and the Settings switch write `{enabled:false}` before they answer. Closing Bunny does not turn access off.
- **be9b31b.** `applyTrayRule` now keeps every key of the patch. The IPC handler builds that patch from a typed allow-list first (`main.js:180-186`), so nothing new can be saved through it.

## RS4-a (MEDIUM, required): with no saved network name, any Public network in the same /24 reopens it

`canReopen` falls back to "same /24" whenever no network name was saved. On Windows that happens whenever `networkProfileOf` returned null at turn-on:
- PowerShell took longer than its 5 s limit (a cold start on a busy PC),
- the interface alias was not found,
- or PowerShell failed.

192.168.0.x and 192.168.1.x are the defaults of most routers. So after a restart Bunny would open over plain HTTP on a café's Public Wi-Fi. Probe (`docs/security/remote-stay-probe/can-reopen.mjs` on 6c1a901):

    no saved name, Public cafe Wi-Fi in the same /24: {"ok":true}
    no saved name, network unreadable now: {"ok":true}
    saved name Home, Public cafe Wi-Fi: {"ok":false,"reason":"Not opened: this network isn't the one you turned it on with. Turn it on again to allow it here."}

**Fix:** on Windows, no saved name means closed. Keep the /24 rule only where the platform cannot name networks at all (not win32). Better still, if the name cannot be read at turn-on on Windows, say so on the row: "Bunny could not tell which network this is, so it will not reopen by itself after a restart." Add a test with `saved.network = null` on win32 and a Public profile.

## RS4-b (MEDIUM, required): PowerShell is started by bare name

`networkProfileOf` runs `execFile('powershell.exe', ..., { env: { ...process.env, ... } })`. That is the W29-1 pattern the project removed: a bare name looks in the current folder first, and it passes the full environment. **Fix:** use `powershellPath()` and `safeEnv({ BUNNY_NET_ALIAS: alias })` from `safeExec.js`, as the other callers do.

## The evil-twin question: no stronger binding required

The Windows network name works as an identity on this PC:
- Windows gives each network profile its own name. A second wired network becomes "Network 2", told apart by its gateway's MAC address.
- A Wi-Fi profile with a password joins a same-named network only if that network accepts the same password. Anyone who has it is already on the home network.

A gateway MAC is readable and copyable by anyone on the network, so binding to it adds little and would break when the router is replaced. The name rule plus RS4-a is enough. (Private keeps reopening anywhere Windows calls Private. That is the person's own marking.)

## Verdict

FAIL at 6c1a901, for RS4-a and RS4-b only. Everything else passes. A re-review needs the diff for these two fixes and a passing `remote-stay` test.
