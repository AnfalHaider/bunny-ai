# D-2 Changes and Files panes (server) — Security review

Date: 2026-11-16 · Session: Security · Reviewed: `6ef4ccf` on `claude/builder-efa9a9` ("D-2 panes, server"): `src/server/panes.js`, the pane routes in `src/server/app.js`, `checkpoints.list`.
Method: code reading, then `docs/security/d2-probe/probe.mjs` against `panes.js` from that commit on a throwaway folder in the temp directory (a "secret" outside it, a junction inside it pointing out). No real folder or profile was touched.

## Verdict: **not signed yet. Four changes first, then I sign at the final sha.**
The read-only containment gate, `inside()`, held against everything I threw at it. The Changes route does not use it and leaks through a link; two cost problems let one click hurt the app.

## What held (read and list paths)
Refused: `..` in three spellings, absolute (back and forward slashes), drive-relative (`C:x`), UNC (`\` and `//`), the extended `\?\` prefix, device paths, NUL bytes, a junction pointing outside (read and list), trailing dot or space, reserved device names (`CON`, `NUL`, `COM1`, `aux.txt`), and the folder itself as a file. Allowed and harmless: names that stay inside (upper case, `file::$DATA` which is the same file, an 8.3 short name). The routes are `GET` only, under `/api/`, so they need the S-1 token, a same-origin request and the right Host; no header-less exception. Not tested: a *file* symlink (creating one needs a privilege this account lacks; `realpath` is applied to it in the same gate, so I expect the junction result to hold).

## Changes to make
**D2-1 MEDIUM, `changesFor` leaks through a link (probe: `**LEAK**`).** It checks that a checkpoint's file path is inside the folder by text only (`relative(base, resolve(f.path))`, `panes.js`), then `readFile`s that path, following links. With a checkpoint entry `project/dirlink/secret.txt` where `dirlink` is a junction to a folder outside, the diff returned `+OUTSIDE-SECRET`. A checkpoint with such a path is not made by the normal edit tools (the workspace's own `inside()` refuses links that leave the folder) but the route should not rely on that. Fix: run each `f.path` through the same `inside()` (real path inside the real folder) and skip it when it fails; add the junction case to `test/panes.test.js`.

**D2-2 MEDIUM, a file is read whole, then cut.** `readTextFile` does `readFile(real)` and slices to 1 MB afterwards: a 300 MB file grew the server's memory by 301 MB (probe); a file near 2 GB fails or stalls the app, which shares one process with the window. Fix: `stat` first; open the file and read at most `MAX_READ` bytes (plus the 4 KB binary check from the same read); report `bytes` from `stat`.

**D2-3 LOW-MEDIUM, the Changes route can freeze the server.** `lineDiff` is O(rows×cols) per file (about 20 ms for two 1900-line files; 423 ms for 20). `changesFor` re-diffs every file of every checkpoint on each call, with no limit on checkpoints, so a long chat with many edits blocks the event loop (all other requests, the window) for seconds. Fix: cap the number of checkpoints and files per answer (newest first, with a "more" flag), or compute the diff for one checkpoint on request; stop a file's diff above a total work limit.

**D2-4 LOW, listing and reading disagree about `.git` and `node_modules`.** The list hides them; the read route serves `.git/config` (probe: read) and lists `.git` by path. `.git/config` can hold a remote URL with a token in it. The person chose the folder and sees only their own page, so this is consistency, not a break, and I accept `.env` readable for the same reason as Builder gives. Fix: make `inside()` callers refuse paths whose first segment is `.git` or `node_modules` (or at least `.git`), so the two agree.

## Accepted as stated by Builder
A sensitive file inside the chosen folder (`.env`) is readable: the person picked the folder, the page that asks is their own, and the model's `read_file` tool already reads it.

## Next
When Builder sends the final sha with D2-1 and D2-2 fixed (D2-3 and D2-4 can follow), I re-run the probe against it and sign: `node .bootstrap/bin/bootstrap.mjs signoff d-2 --verdict PASS --sha <sha>`.

---

## Addendum: re-review of the final `5f36e04` — verdict **FAIL**

Builder's final commit changed `panes.js` only to add `addedAt` to the diff output; **D2-1 to D2-4 above are all still there** (re-run of `probe.mjs` against `panes.js` from `5f36e04`: the link leak is still `**LEAK**`, a 300 MB file still adds 301 MB, `.git/config` is still readable). My four requests had not reached Builder when they built the last commit, so this is a relay gap, not a refusal. The new routes add one more finding, and it is the most serious.

### D2-5 MEDIUM-HIGH — `/api/folder/files` and `/api/folder/file` read any folder on the computer for anyone holding the page token
The routes only answer for a folder "chosen this launch", but `POST /api/folder/check` is what marks a folder as chosen, and it accepts any existing folder (`checkFolder`). Tested live on an invented profile with the launch token:

| Request | Result |
|---|---|
| `files?folder=C:/Windows`, never chosen | 403 `folder.notChosen` |
| `POST /api/folder/check {folder:"C:/"}` | 200 (now "chosen") |
| `files?folder=C:/` | 200, lists the whole drive |
| `file?folder=C:/&path=Windows/win.ini` | 200, the file's text |
| `POST /api/folder/check` with the user's profile folder, then `files?…&path=.ssh` | 200, lists the SSH folder |
| no token / cross-site | 403 (the S-1 guard holds) |

So the "chosen" set is self-service: it is not a decision by the person, it is one more call by whoever runs script in a Bunny page. Before D-2 the API had no route that reads arbitrary files; this adds one. The routes are not reachable by foreign pages, but any cross-site-scripting flaw in Bunny's own pages (chat rendering, an artifact, a connector result) would now read the whole disk, where before it could only touch chats.

**Fix.** Make "chosen" something only the person can do: in the desktop app, the folder picker (`dialog:pickFolder` in `electron/main.js`, a main-process dialog) records the picked path with the server (for example a one-time handle the server checks), and `/api/folder/check` no longer adds to the set. In plain-browser dev mode keep today's behaviour (no dialog exists). Also refuse a folder that is a drive root or a parent of the data folder, and apply D2-4 (`.git`, `node_modules`) to these routes.

### What passes
The gate `inside()` is unchanged and still holds (all escape cases refused, junction included). The new routes are `GET` only and token-guarded, and the "never chosen → 403" test is real.

### Required before sign-off
D2-1, D2-2 and D2-5 are mandatory. D2-3 may follow; D2-4 belongs with D2-5.


---

## Second re-review: `9ca3f77` — verdict **FAIL** (two things left, both small)

Probes run on a scratch checkout of `9ca3f77` (throwaway folders, invented profile).

**Fixed and verified**
- D2-1: the junction leak is gone (`probe.mjs`: the outside file is no longer reported; changesFor now goes through `inside()`).
- D2-2: reading a 300 MB file takes 2 ms and 1 MB of memory (was +301 MB).
- D2-3: the Changes answer is capped (20 checkpoints, 40 files each, 20,000 diff lines, a `more` flag).
- D2-4: `.git` and `node_modules` are refused by read and by list (`path.hidden`), including `.git/config`.
- D2-5 on the server, when `folderPickerOnly` is on (`createApp({ folderPickerOnly: true })`, tested in-process): a typed `POST /api/folder/check` of `C:/` or the profile folder no longer opens them (`files` → 403); only `app.chooseFolder(path)` does; it refuses a drive root, Bunny's data folder and a parent of it; creating or patching a chat with a typed folder → 403; a picked folder works.

**Still open**
1. **D2-5 is not on in the desktop app.** At `9ca3f77`, `electron/main.js` line 46 is `createApp({ dataDir })`: it does not pass `folderPickerOnly`, and the `dialog:pickFolder` handler (lines 135-139) returns the path without calling `chooseFolder`. There is no `folderPickerOnly` or `chooseFolder` anywhere under `electron/` on the branch. As shipped, the real app behaves as it did at `5f36e04`: any token holder can mark any folder chosen. (Builder's note says main.js passes it; that change is not in the commit, perhaps still uncommitted.) It also has to be wired both ways: turn the flag on and call `chooseFolder` with the picked path, or desktop chats will get 403 when the person picks a folder.
2. **Two other routes store a folder unchecked, even with the flag on.** `POST /api/schedules` with `folder` = the profile folder returned 200, and `POST /api/projects` with a folder returned 200. A scheduled run opens a chat in that folder and the pane routes then list and read it (the never-browse list only stops drive roots and Bunny's data). Same gate (`folderToStore`) on both.

Everything else holds; once these two are in I expect to sign PASS after one re-run.


---

## Third re-review: `98ee19a` — verdict **PASS**

Builder's note was right this time, and I read the files at the sha: `electron/main.js` line 46 is `createApp({ dataDir, folderPickerOnly: true })`, and the `dialog:pickFolder` handler calls `bunnyApp.chooseFolder(picked)` and returns `null` when it is refused (lines 138-141). Tested in-process on an invented profile with the picker-only mode on:
- Typed folders are refused on `POST /api/sessions`, `PATCH` chat, `PATCH .../setting/folder`, `POST` and `PATCH /api/projects` and `/api/schedules`: 403 `folder.notChosen`. With no folder, those routes work as before.
- A typed `POST /api/folder/check` of `C:/` no longer opens it (`files` → 403); only `chooseFolder` does, and it refuses a drive root and Bunny's data folder; a picked folder lists and reads.
- D2-1 to D2-4 still hold (re-run of `probe.mjs` against this commit's `panes.js` was done at `9ca3f77`; `panes.js` is unchanged since).
- Across an app restart the "chosen" set is empty again, and old chats keep working (their saved folder is used as before); a new chat needs a fresh pick, which the page already asks for.

**One thing to tell Builder, not a security blocker:** `planRefuses` now includes risk `own` (the Q2-S2 fix for `move_to_new_chat`). That also refuses `ask_user` and `create_artifact` in Plan mode: in an in-process run the model's call to `ask_user` produced no question (the reply simply finished), where it should ask the person. Plan mode is where clarifying questions matter most. Suggest refusing `own` only for `move_to_new_chat`, or keeping `ask_user` and `create_artifact` allowed.
