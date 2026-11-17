# W6-6, W6-10, P4-1, qa-batch, audit-exceptions: Security review

Run after the 6dd1748 gate ended, one file at a time, on invented profiles and temp folders.

## W6-6 at 0a6ec13: PASS (HIGH)

The probe is `docs/security/w6-6-probe/install-probe.mjs`. It is offline and uses W6-6's own `runCommand`, with its fixed environment and npm told twice to skip scripts. Results:

| Case | Result |
|---|---|
| 1 root postinstall, root prepare | did not run |
| 1 a git dependency's prepare and install scripts | did not run |
| 2 the repository's `.npmrc` with `git=`, `script-shell=` and `ignore-scripts=false` | npm DID try to start the `.npmrc` `git=` program. It failed only because Node will not spawn a `.cmd` without a shell (EINVAL); an `.exe` would have run. The installer deletes `.npmrc`, `.yarnrc`, `.yarnrc.yml` and `.pnpmfile.cjs` right after the sha check and before npm (`toolInstall.js:185`), so this case is closed by that deletion, and the deletion is necessary. |
| 3 removing a tool folder that is, or holds, a junction to the person's files | the victim file is kept |
| 4 an `npm.cmd` or `npm.bat` committed at the clone's root | did not run (npm is `node <absolute npm-cli.js>`, no shell) |
| 5 a `git.exe` at the clone's root (really `whoami`) | the real git ran (absolute path from PATH only, `NoDefaultCurrentDirectoryInExePath=1`) |
| 6 npm's own git lookup for a git dependency, with a `git.exe` (really node) in the clone | the real git ran |

Tests: `w6-6-install` 22 of 22. Earlier reviews still hold:
- The card is built from one commit, and `expectSha` comes from the route.
- It asks in every mode, is refused in Plan mode, and is in HELPER_NEVER.
- `folderOf` accepts one plain name only.
- `POST /api/mcp` drops `source`.
- The card says the npm settings are ignored and that the connector is added switched ON. The install card is the person's yes for that.

## W6-10 at 504c388: PASS (supersedes FAIL at 9859ea6)

Probe `docs/security/w6-10-probe/zz-own-server.test.js`, against the REAL app: the request guard is on and the port is registered at `listening`.
- A plain `GET /` straight at the app carries `<meta name="bunny-token">`. This confirms what W610-1 protects.
- `fetchLimited(..., { allowLoopback: true })` refuses ("will not fetch its own server") all of these:
  - `127.0.0.1`, `localhost`, `127.1`, `2130706433`, `[::ffff:127.0.0.1]` and `x.localhost` at Bunny's port;
  - `localtest.me` at Bunny's port (a name that resolves to loopback);
  - a local server on another port that redirects to Bunny's `/`.

Tests: `w6-10-inspect-capture` 15 of 15, `download-file` 14 of 14. W610-2: `authorizeWrites` judges every path before anything is written.

## P4-1 at 9f329f5: PASS

On Update, a new skill arrives OFF and is listed, and a skill whose instructions or description changed (compared exactly) is switched off and listed. `w4-11-p4` 6 of 6.

## qa-batch at 883dafd: PASS

The 48 MB cap is on the message route only, behind the request guard. G11 hand-over only from a plugin owner. The quick-ask bar is held to the chat's limits.

Tests: `message-body-size` 1, `quick-ask-file` 11, `quick-ask` 15, `w4-11-p4` 7, `plugins` 2 (36 of 36).

LOW for later: parallel large bodies take about 4 times their size in memory. Refuse on content-length, read one large body at a time, and stop draining at twice the cap.

## audit-exceptions at 735e286: PASS (NOT for merge until the owner decides)

My changes 2 and 3 are in.
- Each entry needs `owner_words` and `said_at`; pending values do not count.
- The gate reads `git show HEAD:docs/security/audit-exceptions.json`, and fails when the working copy differs or the file is not committed.
- Nested paths, case and a trailing slash are tested. `audit-exceptions` 10 of 10.

Change 1 is still required at merge and is the owner's guard decision. In `.bootstrap/policy.json`:
- add `docs/security/audit-exceptions.json` to `records.globs`, whose writers are chief-of-staff only;
- add `scripts/audit-exceptions.mjs` to `protected_globs`.
