# S-UPD (6ac601a) and RUN (29aba58) — Security review

## S-UPD, `claude/builder-b-supd` @ 6ac601a — PASS

Change: `electron/updater.js`, `test/updater.test.js`.

Holds:
- No checksum means no install. `check()` refuses a newer release whose `sha512` is missing before anything is downloaded. `download()` refuses again on its own, and the digest comparison is no longer skipped when `sha512` is empty (`if (digest !== release.sha512)`). So every installer that reaches `ready` matched a published SHA-512.
- The feed is GitHub's `releases/latest` or `BUNNY_UPDATE_FEED` (env only, `electron/main.js:285`). `updateUrl` is a window-only setting.
- Versions are compared like semver: `0.1.9-rc.1` < `0.1.9`, the same or older downloads nothing, so there is no downgrade.
- `node --test test/updater.test.js` at 6ac601a: **10 of 10** pass (no latest.yml, no sha512 line, empty sha512, pre-release order, rc not offered over the plain version).

Notes (LOW, may follow):
- **SUPD-1.** `readRelease` reads the checksum with `/^sha512:\s*(\S+)/m`, and `\s*` crosses a line break. A `sha512:` line with no value followed by another key takes that key as the checksum: `node -e` on `"sha512:\nreleaseDate: x"` gives `releaseDate:`. Such a release is still never installed, because the digest cannot match. But it is downloaded first, which contradicts "refused before anything is downloaded". Fix: `/^sha512:[ \t]*(\S+)/m` and accept only base64 of 64 bytes (`/^[A-Za-z0-9+/]{86}==$/`).
- **SUPD-2.** `join(downloadDir, release.name)` uses the asset name as given. GitHub cleans asset names, so the release feed cannot carry a path. Only a hand-set `BUNNY_UPDATE_FEED` could. Use `basename()`.
- **Scope note.** The checksum comes from the same release as the installer, so it proves the download is complete and is the published one. It does not prove who published it. That needs code signing (Authenticode) of the installer, which is a separate row and not part of 0.1.9.

## RUN, `claude/builder-b-run` @ 29aba58 — PASS

Change: `package.json` (`npm test` runs `node scripts/unit-tests.mjs` after the three `node --check`s), new `scripts/unit-tests.mjs`. `scripts/gate.mjs` still runs `npm test` as its unit step.

Holds:
- Nothing is skipped. At 29aba58, `test/` holds 98 `*.test.js` files and 30 other files. `node scripts/unit-tests.mjs --list` prints "80 parallel files, 18 guard and kit files": 80 + 18 = 98. None of the 30 other files imports `node:test`, so they held no tests. They are helpers, fixtures and server stubs, and the old `node --test test/` also picked them up.
- `--test-timeout=120000` is kept on both steps. No assertion or deadline changed.
- A failure fails the gate. Exit code 1 if either step fails, and also on a signal. A step silent for 4 minutes is killed and counts as a failure, with its last output printed.
- `CLAUDE_PROJECT_DIR` is removed only from the child environment of the guard and kit step, never from the gate's own.

No findings.
