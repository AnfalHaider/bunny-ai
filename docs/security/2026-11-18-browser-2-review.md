# BROWSER step 2 (f741c89 + 86848df, full chats from devices): Security FAIL, with a list of required changes

Reviewed by reading `remoteAccess.js`, `windowOnly.js` and the `app.js` routes at 86848df. Tests from a copy of 86848df, with `NoDefaultCurrentDirectoryInExePath` unset: `remote-access` 21 of 21, `window-only` 16 of 16. The real-Electron probe was not re-run. The failures below are about what the code allows, and those tests don't cover them.

## What holds (from the f741c89 notes, still true at 86848df)

- **Binding.** The server listens only on a private IPv4 address that isn't internal, never 0.0.0.0, and is off after every restart.
- **Request checks.** The Host must be exactly `lan:port`, and the Origin and Sec-Fetch-Site must be same-origin. route() and remoteRoute parse the path the same way.
- **Before sign-in.** A device gets only the sign-in page, under a strict CSP, with no token. The sign-in body is limited to 4 KB.
- **Session.** The cookie is a 32-byte random value, HttpOnly and SameSite=Strict, and every write needs the session's CSRF header.
- **Passcode.** It is stored with scrypt, with backoff for one device and a flood stop for all.
- **Provider keys** are masked in `GET /api/providers` (`registry.list()`).
- **Permission answers** carry only `allowed: true|false`, so a device cannot save a rule.
- **`remoteException` can't be widened** by adding another window-only key next to `permissionMode`. The rest of the body is re-judged by `isWindowOnlyRoute`, and for a session the only window-only key is `permissionMode`. But `folder` is not a window-only key; see R3.

## Required before PASS

**R1. Capability cards a device must not answer.** A device may answer `code_mode` (the chat's own folder) and `leave_plan_mode` (goes to Ask). It must get "Change this in Bunny's window." for:
- `computer_use`: granting it calls `saveSettings({ aiComputerUse: true })` (`app.js:2298`). That switches on driving this computer for the whole app, which the owner kept window-only.
- `custom_tools`: `saveSettings({ customToolsEnabled: true })`, a window-only setting, for the whole app.
- `switch_on_added`: switching on what the model installed (P-6). That is installing, which stays the window's.

Today `remoteException` allows every `/capability/<id>` answer.

**R2. The window's tools stay the window's in a device's turn.** Once the window has switched on computer use or tool building, a chat run from a device (above all in Auto, where no card is shown) would get `computer_*`, `create_tool`, custom tools and the install tools (`install_plugin`, `add_connector`, `add_skill`), and could drive the PC or install. A message sent from a device must offer none of these. The simplest way is to filter `toolDefinitions` when `req.bunnyRemote` is set.

**R3. A device can attach a folder to an existing chat.** `PATCH /api/sessions/<id>` is on the device's write list and its body is not filtered. `patch.folder` goes through `folderToStore`, which accepts any folder the person has picked in the window during this run (`chosenFolders`). So a device can point any chat at, say, the person's project and work in it in Code mode.
- **Fix:** give device PATCH bodies an allow-list (title, model, effort, `permissionMode` and the other plain fields), never `folder`.
- Also turn the message body filter (`MESSAGE_DENY`, a deny-list) into an allow-list: `content`, `attachments`, `providerId`, `model`, `retry`, `vision`, `workMode`, `useSkill`. Then a field added later is closed by default.

**R4. Settings reads leak a secret.** `GET /api/settings` returns `{ ...settings }`, which includes `googleClientSecret` (and the Google and GitHub client ids, and `systemUserName`). For a device, return an allow-list of display settings only (theme, language, names, the model and default choices the page needs), never any key that is a secret.
- On the Chief's question about memory and skills: memory is the person's standing instructions and facts, so it is the most personal data in Bunny. A device can already read every chat, so memory is in proportion only behind a strong passcode. Keep memory reads if the page needs them, or drop them; I lean towards dropping both until a screen needs them.

**R5. Plain HTTP on the LAN now means the whole PC.** With tools and Auto from a device, anyone who can see the traffic on the same Wi-Fi can copy the cookie (or the passcode as it is typed) and run programs on this PC. The window's warning must say that plainly, for example: "Anyone on this network who can see its traffic could take over a signed-in device and run programs on this PC. Use this only on your own home network, never on public or shared Wi-Fi." The firewall advice stays "Private networks only".

## Recommended (not blocking)

- **R6. Auto from a device, the condition Builder A asked about.** Yes, add it. When a device sets a chat to Auto, the window shows it in the status line ("Open to other devices · N signed in · 1 chat in Auto from a device") and on the chat itself. Signing a device out, or turning the setting off, puts its Auto chats back to Ask.
- **R7.** Shorten the idle timeout from 12 hours to about 2, now that a session can run tools. Show the device and the time on the window's device list (already there).
- **R8.** `GET /api/sessions/<id>/…` now opens every GET under a chat to a device, including the Files and Changes panes of a chat's folder. That fits "full chats", but it means a device can read any file in any chat's folder without a card. The owner should know this.

## Answers to Builder A's questions

- **"A device chooses Auto for its chat and runs tools with no card, as the window does":** acceptable as the owner's decision only with R1 to R5 in place, and with R6 recommended.
- **"Can remoteException be widened with permissionMode plus another window-only key?"** No, see "What holds". But `folder` is not window-only and gets through: R3.
- **"Can a device attach a folder to an existing chat?"** Yes, today: R3.

## Re-review at 568f8d5 (R1-R7): FAIL, one gap left (R9)

Tests from a copy of 568f8d5, with the variable unset: `remote-access` 28 of 28, `window-only` 16 of 16.

**R1 to R7: all fixed.**

| Requirement | Fix | Where |
|---|---|---|
| R1 | `REMOTE_CAPABILITIES = ['code_mode', 'leave_plan_mode']`; any other capability answer from a device gets 403 | `app.js:1461` |
| R2 | `remoteToolBlocked` (computer_*, create_tool, install_plugin, install_from_github, add_connector, add_skill, my_*) is filtered out of the tools offered, in the reply and in helper chats, and refused when called | `app.js:2376`, `:3040`, `:2798` |
| R3 | `remotePatch` and `remoteBody` are allow-lists: no folder, project, branch or pin | |
| R4 | `remoteSettings` returns display keys only; memory and skills are off the read list | |
| R5 | the warning text | |
| R6 | a chat a device sets to Auto is marked, and goes back to Ask when the device ends | |
| R7 | 2-hour idle timeout | |

**Builder A's routing hints: acceptable.**
- `job` adds only a fixed `JOB_NOTES` entry, and image output only for OpenRouter.
- `thinking` is one of low, medium or high.
- `auto`, `attemptsLeft` and the `fellBack*` fields are trimmed labels for the "answered by" line.

None of them decides tools, folders, mode or unattended running.

**R9 (HIGH, required): `schedule_task` gets round R2.** A device's chat can call `schedule_task`. With `may_change: true` it creates a schedule that runs **in Auto** in that chat's folder (`app.js:2653`). Its runs are not device turns, so they have every tool the window has switched on, computer control and installs included, with nobody watching. Schedules are on the owner's window-only list.
- **Fix:** add `schedule_task` to `remoteToolBlocked`, and add a test.
- **Also:** confirm that `message_session` does not run another chat's turn inside the server, outside the device flag. If it does, block it for devices too. (`start_session` goes through `runHelper`, which keeps the filter.)

**Recommended:** `remember` lets a device's chat add standing memory that every later chat in the window reads. Memory is now off the device's read list, so writing it is out of balance. Block it for devices, or make it ask.

## Re-review at da9a3a8: PASS (supersedes FAIL at 568f8d5)

**R9 fixed.** `remoteToolBlocked` now also blocks `schedule_task`, `start_session`, `message_session` and `move_to_new_chat`. Those are the tools whose work outlives the device's turn or runs outside it. They are filtered out of the tools offered and refused when called. Helper chats (`run_subagent`) keep the filter through `runHelper`. The tests cover `schedule_task`.

**Idle sessions** are swept every 60 s (the timer is `unref`'d and cleared on close) and before every count or list. A device's Auto chats go back to Ask without waiting for the device to call again.

**Tests,** from a copy of da9a3a8 with the variable unset: `remote-access` 29 of 29, `window-only` 16 of 16.

**Still open, recommended, not blocking:**
- `remember` from a device's chat adds standing memory for every chat in the window. Make it ask, or block it, for devices.
- The real-Electron probe `remote-access-smoke.cjs` was not re-run by Security. This verdict rests on the code reading and the HTTP tests.
- Design's check of the screens against the drawing is still to come.

## Re-stamp at b1b8af5: PASS (supersedes da9a3a8)

- The only code change is to `remoteAccess.js`: `remoteToolBlocked` also blocks `remember` and `list_scheduled_tasks`. That closes the `remember` recommendation.
- The new test scripts `schedule_task` and `remember` calls from a device chat in Auto. They create no schedule and save no memory, the tools are not offered, and the window's own chat still has them.
- `remote-access` 29 of 29 at da9a3a8 is now 30 of 30, from a copy of b1b8af5 with the variable unset.

## Re-stamp at 4bd9f64, the device tool allow-list: PASS (supersedes b1b8af5)

**The rule.** `remoteToolBlocked(name)` is now `!REMOTE_TOOLS_ALLOWED.has(name)`. A new tool, a connector's tool or a tool the model built is denied by default.

**The test.** It reads the whole tool registry (more than 50 tools, 64 today). It fails when a tool is on neither list or on both, and it checks every earlier denial and the default deny for unnamed names. Tests from a copy of 4bd9f64, with the variable unset: `remote-access` 30 of 30, `window-only` 16 of 16.

**Builder A's decisions:**
- **Account tools allowed** (github_*, gmail_* including gmail_send, calendar_create_event, drive_*): **agreed**, as the owner's "full chats". Sending mail always shows a card, which the device answers. The owner should know that a signed-in device can approve sending mail as them.
- **run_command and start_process allowed** (a Code chat, and in Auto without a card): this is the owner's decision. It is the reason for the plain-HTTP warning (R5), the 2-hour idle limit, and the Auto mark in the window (R6).
- **list_sessions, read_session and search_chats allowed:** agreed. A device can already read every chat through the API.
- **request_capability and run_subagent allowed:** agreed. R1 limits a device's answers to `code_mode` and `leave_plan_mode`, and helper chats keep the filter.
- **browser_* denied:** agreed. A device has no panel, and the panel is the window's.
- **Connector tools (call_connector_tool, list_connector_tools, and every connector tool name) denied: keep them denied.**
  - A local connector is a program running on this PC. It can reach files and services outside the chat's folder fence and outside the rules Bunny applies to its own tools, such as a filesystem or database server.
  - A remote connector acts on the person's accounts with tokens Bunny holds.
  - Connectors are already window-only to add and to trust. Letting a device use them is the widest door left, and the least visible.
  - This narrows "full chats" by one feature, so the owner should decide. My recommendation is to keep it denied for v0.1.10, and later allow only connectors the person marks "available from devices" in the window.

## Re-stamp at 4d2a894 (d072403, f50710f, 4d2a894: the page side only): PASS (supersedes 4bd9f64)

- **Nothing on the server or in the shell changed.** `git diff 4bd9f64 4d2a894` touches only `src/ui/api.js`, `src/ui/browser-mode.js`, `src/ui/chat.js`, `src/ui/settings.html`, `e2e/browser-lock.spec.js` and `test/browser-mode.test.js`. Every refusal is still the server's.
- **`api.js`** only adds a "refused" event, the locking of controls and the card watcher. How a write is sent, and when the desktop bridge is used, are unchanged.
- **`DEVICE_CAPABILITIES`** (`browser-mode.js:111`) is `['code_mode', 'leave_plan_mode']`, equal to the server's `REMOTE_CAPABILITIES` (`remoteAccess.js:119`), which is R1. A browser tab on this PC locks every card. A device locks only the capability cards it may not answer.
- **Tests** from a copy of 4d2a894, with the variable unset: `browser-mode` 5 of 5, `remote-access` 30 of 30.
- **For the release check:** `browser_compare` (W6-11) is not on `REMOTE_TOOLS_DENIED` in this branch; it lives on Builder C's branch. When the branches meet, the classification test will fail until it is added there, as the Chief of Staff has asked of Builder B. I'll check that in the release candidate.

## Re-stamp at 564b28b: PASS (supersedes 4d2a894)

- **Page side only.** `git diff 4d2a894 564b28b` touches `src/ui/browser-mode.js`, `src/ui/chat.js`, the e2e spec and `test/remote-access.test.js`. Nothing under `src/server` changed.
- **The model chip on a device** now PATCHes the chat's own `setting/providerId` and `setting/model`, both already on the device write list (`remoteAccess.js`, 568f8d5), instead of writing the app's default. A device's `PUT /api/settings` is still refused (new test).
- **The escaped-dot fix** turns `(customize|providers|automation).html$` into `\.html$` in the page-name tests that choose which controls to lock. That is UI-only, and stricter.
- **Tests,** from a copy of 564b28b with the variable unset: `remote-access` 31 of 31, `browser-mode` 5 of 5.

## Re-stamp at 0e5bc55 (RA-1, found by Tech Lead on 9d4e942): PASS (supersedes 564b28b)

- **The problem.** A wrong try was counted only after its scrypt check finished, so tries sent at the same moment all ran (60 wrong passcodes were all checked). I missed this in my f741c89 reading; Tech Lead found it.
- **The fix.** `signIn` now reserves the try **before** scrypt:
  - A device has `FAILS_BEFORE_WAIT` (5) tries in all, counting those still being checked, then one at a time. Its own timed lockout (`waitFor`) is still checked first.
  - Everyone together has `FLOOD_LIMIT` (30) failures plus the tries in flight before the 60 s wait.
  - The reservation is released in a `finally`, so a thrown check can't leak a slot.
  - The rest of `remoteAccess.js` is unchanged.
- **Tests,** from a copy of 0e5bc55 with the variable unset: `remote-access` 34 of 34. They include 60 wrong passcodes at once from one device (5 checked, 55 told to wait), the flood across devices, and a right passcode working after the wait.

## Re-stamp at 975970a (F-1 and F-2, page side only): PASS by code reading (supersedes 0e5bc55)

- **Nothing under `src/server` changed.** The diff from 0e5bc55 touches `src/ui/api.js`, `src/ui/browser-mode.js`, the e2e spec and `test/browser-mode.test.js`.
- **`deviceException`** (`browser-mode.js:169`) equals `remoteException` (`remoteAccess.js:107`) line for line: the same three cases and the same `UUID` pattern (`[a-f0-9-]{36}`), with the server's `isWindowOnlyRoute` passed in. It allows nothing wider.
- **`api.js`** uses it only on a device page (`isDevicePage()`) and only to skip the page's early refusal. The server still decides every request, as before.
- **F-2** re-applies the permission-rules lock after a redraw. That is UI only.
- Builder A's tests were not re-run by Security for this stamp (a read-only check, while the K-5 guard runs used the PC). QA's walk at 975970a passed 80 of 80.
