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
