---
piece: s5-s7
role: security
sha: 6b2a351
verdict: PASS
date: 2026-11-17
---

# S-5..S-7 (6b2a351), W6-11 (1ee1b01), W2-9 (395021d): Security review

Branch `claude/builder-c-v0110`. I ran each piece's unit tests once, file by file, from a temporary copy of 395021d (which holds all three):

| Test file | Pass | Fail |
|---|---|---|
| `s5-confirm` | 2 | 0 |
| `secretStore` | 7 | 0 |
| `updater` | 15 | 0 |
| `w6-11-compare` | 5 | 0 |
| `browser-tools` | 4 | 0 |
| `w2-9-worktree` | 12 | 0 |

## S-5..S-7 at 6b2a351: PASS

**S-5, move_to_new_chat:**
- It always asks now, also when the "new chat" setting is on; the setting only picks the recommended answer.
- The card shows the first 600 characters of the message the model wrote.
- With nobody to answer, the answer is not "Start a new chat", so the work stays in the chat.

**S-5, memory import:**
- Settings first calls `/api/memory/import` with `preview: true` and lists what would be saved, as text nodes. The second press saves.
- The route is behind the request guard, so only Bunny's own pages reach it. The preview protects the person from pasting text that hides instructions.

**S-6, the secret store:**
- PowerShell is started by its full path, `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, with the script on stdin.
- A saved cipher must match `^[A-Za-z0-9+/]+={0,2}$` and be at most 64 KB before it goes between `'…'` in `FromBase64String`. So a changed file cannot break out of the quotes; it reads as a missing secret.

**S-7, the updater:**
- It downloads into `<data dir>/updates`, created with mode 0700.
- `install()` hashes the file again just before it runs. On a mismatch it deletes the file, clears `ready` and runs nothing.
- `before-quit` awaits that check.
- LOW: a short window is left between the hash and Windows starting the installer. This is acceptable, because the folder is the person's own profile folder.

**Two earlier sign-offs this branch touches (481a27d, not asked, checked anyway):**
- The updater now accepts a quoted `sha512: "…"` (`/^sha512:[ \t]*(["']?)([^\s"']+)\1[ \t]*$/m`). The value must still be exactly 86 base64 characters plus `==` (`updater.js:70`), and an opening quote with no matching close gives null. SUPD-1 still holds.
- The memory guard now has one large-body slot per size limit, not one for the whole app. There are 5 limits (48 MB messages, 15 MB, 2 MB, `MAX_IMPORT`, `MAX_BROWSER_ANSWER`), so at most one body per limit is held at a time. That is bounded and acceptable.

## W6-11 browser_compare at 1ee1b01: PASS

- Each address must pass `loadable`, the same rule as `browser_open` (W6-24). It allows http and https only, and refuses Bunny itself in every loopback spelling and on its port.
- The rule is checked before loading and again on `will-navigate` and `will-redirect`, and `window.open` is denied.
- A name that resolves to loopback at Bunny's port (such as `localtest.me`) still cannot reach Bunny's page: the S-1 Host check accepts only `127.0.0.1:<port>` or `localhost:<port>`.
- The hidden windows use the panel's partition, with `sandbox`, `contextIsolation`, no Node, no webview tag, `webSecurity` and `safeDialogs`, and **no preload**. They are destroyed in `finally`, and `prepareSession()` (the panel's permission and download rules) runs first.
- Widths are 320 to 1920, at most 3. Loads time out after 25 s. The pictures are `data:image/png` only and saved under the chat's screens folder.
- **Reach:** it can open localhost and LAN addresses, such as a dev server or a router page, and it uses the panel's cookies. This is exactly what `browser_open` plus `browser_screenshot` can already do at `read` risk, so the scope is not new. Only the windows are hidden.
- MEDIUM, for later and for the owner's view of the browser tools as a whole: the person cannot see a hidden compare. The tool-use line in the chat ("Compare A with B") is the only trace. If LAN pages should need a yes, that belongs to all the browser tools, not this one.
- LOW, reliability: the `did-fail-load` listener is `once`, so a subframe failure that comes first uses it up, and a main-frame failure then waits out the 25 s timeout.

## W2-9 worktree per code chat at 395021d: FAIL

### W29-1 (HIGH): Bunny runs a `git.exe` that sits in the project folder

`worktrees.js` `runGit` calls `execFile('git', args, { cwd })` by bare name. On Windows, a bare name is looked up in the `cwd` first unless `NoDefaultCurrentDirectoryInExePath` is set, and the installed app does not set it. The `cwd` is the person's project folder (`eligibility`, `create`, `finish`, `merge`) or the chat's copy (`status`, the work-in-progress commit). Both hold files Bunny doesn't control: a cloned or downloaded project can carry a `git.exe` at its root.

`GET /api/sessions/<id>/worktree` runs `eligibility(session.folder)`, which runs `git rev-parse` in that folder, whenever the Code chat's copy switch is shown. So just opening such a project in a Code chat runs the program, with no card. The chat's permission mode doesn't matter, and no yes is asked for.

**Probe:** `docs/security/w2-9-probe/planted-git.mjs` with 395021d's own `worktrees.js`. It puts `whoami.exe` into a temporary project folder as `git.exe` and calls `runGit([], { cwd })`:
- with `NoDefaultCurrentDirectoryInExePath` unset, as in the installed app, the answer is this PC's user name: **the planted program ran**;
- with it set to 1, the real git ran.

**Why the unit tests pass:** the session shells set `NoDefaultCurrentDirectoryInExePath=1`, so a test of this must delete it from the child's environment.

**Required fix:**
- Resolve git once to an absolute path from PATH entries only, never `.` or the `cwd`. Reuse `toolInstall.js` `findOnPath`, which W6-6 fixed for the same reason.
- Run it with `NoDefaultCurrentDirectoryInExePath: '1'` in the child's environment, with no shell, as `toolInstall.js:58` does.
- Add a test that plants `git.exe` (a copy of `whoami.exe`) in a project folder and **deletes** `NoDefaultCurrentDirectoryInExePath` from the child's environment.

### W29-2 (MEDIUM, with the fix): Bunny's own git runs the repository's hooks and fsmonitor

- `worktree add` runs the repository's `post-checkout` hook.
- `commit --no-verify` skips `pre-commit` and `commit-msg`, but still runs `post-commit`.
- `status` runs `core.fsmonitor` if `.git/config` names a program.

These come from the person's own `.git`, which a clone does not carry, but a downloaded or zipped project with its `.git` folder does. For the git commands Bunny runs on its own, add `-c core.hooksPath=<an empty folder under the data folder> -c core.fsmonitor=false`.

### What holds

- **No command injection.** git gets an argument list, never a shell.
- **The branch name can't be turned into a git option.** It is `prefixOf(prefix)` plus a title slug of `[a-z0-9-]` plus the first 8 characters of the chat id. `prefixOf` keeps only `[A-Za-z0-9/_-]`, removes any leading `/` or `-`, and falls back to `bunny/`, so the name can never start with `-`. `finish` uses only the branch saved in the server-written record.
- **Path containment.**
  - A copy lives at `<data>/worktrees/<slug>-<hash6>/<id8>`.
  - `usable()` compares real paths, so a junction out of the folder fails.
  - A forced `rm` happens only inside the worktrees folder.
  - `removeLeftover` accepts only real paths exactly two levels down that no saved chat names.
  - Node's recursive `rm` does not follow a junction inside a copy (checked in W6-6, case 3).
- **The record can't be set from outside.** Only `setWorktree` (create and finish) writes it. `/worktree` and `/worktrees/remove` are window-only. The list and the export carry the branch name only, never the path.
- **The gate exception.** `effectiveRoot` uses the copy's real path only while `usable()` holds. A copy that is gone is not sent back to the picked folder.
- **The model can't rewrite git's pointer.** The file tools refuse any path segment named `.git` (`workspace.js:260-278`), so the model cannot edit a copy's `.git` file to aim Bunny's own git at a config or hooks of its choosing.

### Existed before (not W2-9), for the board

- MEDIUM: `github.js:250` clones with the token in a `-c http.extraheader=…` argument. Other programs on this PC can read a process's command line while the clone runs, which goes against "no credentials on the command line" (O6). Pass it through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` in the environment instead.
- LOW: that clone also starts `git` by bare name. Its `cwd` is Bunny's own folder, so the risk is low, but it should use the same resolved git.
