---
piece: release-0.1.13
role: tech-lead
sha: 43ced06
verdict: PASS
date: 2026-11-18
---

Read 0603d13..43ced06, linear with no merges, 26 commits. DEVICE-FULL: remoteRoute checks the host, the origin, the cookie and the CSRF token before the level; at Everything the device is refused /api/remote* on the decoded path both in remoteRoute and in route; the PATCH level and GET /api/remote/log routes are window-only; the log keeps names, methods and paths only; labels are drawn with textContent. PRIV-2: an invented profile reads Sam or BUNNY_DISPLAY_NAME, never the OS user name. applyTrayRule merges the already-cleaned patch. REMOTE-STAY: remote-state.json keeps no secret; canReopen fails closed (Windows with no saved name, or a name that cannot be read); PowerShell runs by its full path with safeEnv and the interface name passed in an env var; sessions are never saved. CHAT-SWITCH: pushState and popstate, the latest click wins through switchToken, the page reloads while streaming. THEME: the theme:set IPC checks isOwn and an allow-list; theme-boot.js reads localStorage only. Quick ask: barLook passes fixed keys; the Esc, close and escHandled IPC calls check fromBar; the CSP adds only font-src 'self'. FONTS: 13 woff2 files with OFL texts, and the service worker caches src/ui/fonts. The release script reads package.json at HEAD, so the version bump at 256a721 is fine. app.css matches its build at 43ced06. Nine test files pass 101/101 in a scratch copy. The Chief's gate reads 9/9 at 43ced06 (unit 198/198, e2e 394). Non-blocking notes: on Windows, resumeOpenToDevices is awaited before createWindow, so the PowerShell lookup can hold the first window up to 5 s; the remoteAccess.js comment on 'on' still says it is never read back.
