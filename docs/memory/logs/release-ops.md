# Release Ops - session log

Newest entry on top. Only this session writes this file.

## 2026-11-18 - Published v0.1.11

**Word:** the Chief of Staff's 7E relay: the owner answered "Yes, release v0.1.11" to "Release v0.1.11 (the row fix, the chip fix and the web app) once it passes every check?", then "i am driving , push and release." and "push and release when ready". The web app moved to v0.1.12. The relay had the shas, the pasted gate (9/9 at 28812e1) and the sign-off row; I accepted it at once.

**Commands (PST)**

- Fresh worktree prepared by the Chief of Staff (role set), detached at 4cebedc = origin/main.
- `npm ci`, `npm run dist` -> build-sha 4cebedc, tree clean, `latest.yml` 0.1.11 with sha512.
- `npm run release -- --dry-run --notes-file docs/releases/v0.1.11-notes.md` clean (3 files).
- `npm run release -- --notes-file docs/releases/v0.1.11-notes.md` ran 08:11 to 08:17 (GitHub publishedAt 2026-11-18T03:17:03Z) -> https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.11
- Checks: not draft, not prerelease; .exe 122362916, .blockmap 128707, latest.yml 348; tag v0.1.11 -> 4cebedc; feed serves 0.1.11. Downloaded the uploaded .exe: sha256 db6124dd6e9f718e202742d96fabac761ebbf92fcbb06c6ee9059c531a1283f0 equals my built file; sha512 and size equal latest.yml.

**Not checked:** an update on an invented profile; the record, notes and sign-off files (hook bars me).

**Rollback:** a higher version (0.1.12) with 0.1.10's code; pulling the release is owner-only.

**Lesson:** no lesson; a complete relay plus a prepared folder made this the fastest release.

## 2026-11-18 - Published v0.1.10

**Word:** the Chief of Staff's 7E relay: the owner's words (2026-11-18) "Both artifacts approved, now fix all issues discussed and pending gaps. Then push the update and release. Ensure all issue are fixed in this build." and "Browser option tonight everything in the same build"; the question as asked, shas, sign-offs. The first relay only pointed at the gate file, so I held until the Chief pasted the gate (9/9 at 975970a). Then accepted.

**Commands (PST)**

- Fresh worktree (scratchpad `release-0.1.10`), detached at db4ab9a (= origin/main); role set by the Chief of Staff.
- `npm ci`, `npm run dist` -> build-sha db4ab9a, tree clean, `latest.yml` 0.1.10 with sha512.
- `npm run release -- --dry-run --notes-file docs/releases/v0.1.10-notes.md` clean (3 files).
- `npm run release -- --notes-file docs/releases/v0.1.10-notes.md` ran 06:12 to 06:18 (published 2026-11-18T01:18:36Z by GitHub's clock, as shown) -> https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.10
- Checks: not draft, not prerelease; .exe 122362712, .blockmap 128727, latest.yml 348; tag v0.1.10 -> db4ab9a (the built commit); feed serves 0.1.10. I downloaded the uploaded .exe: sha256 82153b85a7ed2d5fe5b9d1f98bafd8830c49c8e84809738e0ca42aefc05cd766 equals my built file; sha512 equals latest.yml.

**Not checked:** an update on an invented profile; the sign-off files, record and notes (hook bars me).

**Rollback:** a higher version (0.1.11) with 0.1.9's code; pulling the release is owner-only.

**Lesson:** a relay that points at the gate file instead of pasting it costs a round trip; 7E needs it pasted.

## 2026-11-18 - Published v0.1.9

**Word:** the Chief of Staff's 7E relay: the owner's words (2026-11-17) "add the fix for this and other similar layout issues to 0.1.9 ... ensure all remaining gaps and fixes are built and pushed to main with the release ... 0.1.9 will be completely built and pushed, including the installer and release", and (2026-11-18) "Sign the exception"; the question as asked, shas, pasted gate 9/9 at b9bdd7a, all five sign-offs PASS. Accepted because the words name 0.1.9 and the release.

**Commands (PST)**

- Fresh worktree outside the project (scratchpad `release-0.1.9`), detached at 8b49c55 (= origin/main); role set by the Chief of Staff.
- `npm ci`, `npm run dist` -> build-sha 8b49c55, tree clean, `latest.yml` version 0.1.9 with sha512.
- `npm run release -- --dry-run --notes-file docs/releases/v0.1.9-notes.md` clean (3 files).
- `npm run release -- --notes-file docs/releases/v0.1.9-notes.md` ran 01:12 to 01:20 -> https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.9
- Checks: not draft, not prerelease; .exe 122320093, .blockmap 128637, latest.yml 345; tag v0.1.9 -> 8b49c55 (the built commit); latest feed serves `version: 0.1.9` with the sha512.

**Not checked:** an update on an invented profile; the sign-off files (hook bars me); the record and notes contents (hook bars me; `release.mjs` accepted them).

**Rollback:** a higher version (0.1.10) with the last good code (0.1.8's); pulling the release is owner-only.

**Lesson:** no lesson; the fresh-worktree recipe ran clean first time.

## 2026-11-17 - Published v0.1.8

**Word:** the Chief of Staff's 7E relay: the owner's words "I am thinking we push the update done ao far, including the release and installer. as 0.1.8 and the rest we will do in 0.1.9" (2026-11-17), the question as asked, shas, pasted gate 8/8 at 685b93d, all five sign-offs PASS at a6afcf5. I accepted it because the words name 0.1.8 and the release. Then held at the Chief's request while Security ruled on an OAuth finding (verdict SHIP; a 0.1.9 fix row; P-6, L-4 and RO-1 ship open as in 0.1.7). The Chief then sent "publish".

**Commands (PST)**

- Fresh worktree outside the project (scratchpad `release-0.1.8`), detached at 7d19eee; `npm ci`, `npm run dist` (clean).
- Dry run refused: "No release record for v0.1.8 in docs/releases..." because the record said `scope: 0.1.8`, not `scope: v0.1.8`. I stopped; the Chief fixed the record on main (af77b62, docs only).
- Same folder detached at af77b62; `npm run dist` -> build-sha af77b62, latest.yml 0.1.8, tree clean; `npm run release -- --dry-run --notes-file docs/releases/v0.1.8-notes.md` clean.
- `npm run release -- --notes-file docs/releases/v0.1.8-notes.md` ran 19:18 to about 19:27 -> https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.8
- Checks: not draft, not prerelease; .exe 122275508, .blockmap 128477, latest.yml 345; tag v0.1.8 -> af77b62 (the built commit); latest feed serves `version: 0.1.8`.

**Not checked:** an update on an invented profile; the sign-off files (hook bars me).

**Rollback:** a higher version (0.1.9) with the last good code; pulling the release is owner-only.

**Open items at close (Chief of Staff retired 2026-11-17; Release Ops holds):**

- Leftover `src/ui/app.css` (line endings only) uncommitted in my old worktree `release-ops-7f2a25`; my role may not revert it, and the Chief said to leave it. It also stops me merging origin/main into this branch, so this branch still has the old `.bootstrap` (no `brief` command).
- The scratchpad worktree `release-0.1.8` (detached at af77b62, role release-ops) is left in place until told to remove it. Older worktrees `release-ops-v016`, `release-ops-v017` and `release-ops-v017b` under `.claude/worktrees/` are also still there.
- QA gap 15: the updater skips the checksum when there is no `latest.yml`. Reported to me by the Chief of Staff; I have not checked it myself.
- QA gap 19: the installer's sha512 is not verified locally. Same: reported, not checked by me.
- Not checked for 0.1.5 to 0.1.8: an update on an invented profile; the sign-off files (a hook bars my role).
- 0.1.2 to 0.1.4 have no release records (predate the family); the Librarian holds the owner question.
- Next: v0.1.9 only on the owner's go, via a 7E relay or "release v0.1.9" typed in my chat.

**Lesson:** the record's `scope:` line must read `v<version>` exactly; `release.mjs` greps for it. Run the dry run right after the record lands, before the owner is waiting on the build.

## 2026-11-17 - Published v0.1.7

**Word:** the owner typed "release v0.1.7" in my chat (2026-11-16, after the Chief of Staff's relay of "push to main" and "PUSH THE UPDATED INSTALLER ALSO", which I did not take as the release word). First attempt at 41d7ac1 was refused by `release.mjs`: `npm run dist` dirtied `src/ui/app.css` (CRLF) and wrote no `latest.yml`. The owner said "Fix it now"; Builder's fix 6b06ed9 landed in main 9be14d7.

**Commands (server time 2026-11-17)**

- Fresh worktree `release-ops-v017b` detached at 9be14d7; `node scripts/bootstrap.mjs`; `npm run dist` -> clean tree, `dist/build-sha.txt` = 9be14d7 (no "-dirty"), `latest.yml` version 0.1.7.
- `npm run release -- --dry-run --target 9be14d7 --notes-file docs/releases/v0.1.7-notes.md` -> clean.
- `npm run release -- --target 9be14d7 --notes-file docs/releases/v0.1.7-notes.md` (started 00:26 PST) -> https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.7. The 122 MB upload took over 19 minutes (the release sat as a draft meanwhile); I did not kill it.
- Checks: not a draft, not a prerelease; assets .exe 122232036, .blockmap 128484, latest.yml 345; `git ls-remote --tags origin v0.1.7` -> 9be14d7a (the built commit); latest feed serves `version: 0.1.7`.

**Not checked:** an update on an invented profile; the sign-off files (hook bars me).

**Rollback:** a higher version (0.1.8) with the last good code; pulling the release is owner-only.

**Lesson:** a long upload leaves a draft that looks stuck. Check `gh.exe` is still alive and wait; killing it leaves a draft only the owner can delete.

## 2026-11-16 - Finding: release tags point at the wrong commit

Raised by the Chief of Staff (plan row W5-8, ff747ec). Tags v0.1.5 and v0.1.6 both point at 5c46fd4, the tip of `initial-import` (GitHub's default branch), not at what was built (73d3bef and dfac0db). I saw v0.1.5 -> 5c46fd4 in `git ls-remote --tags origin` myself. Cause: `scripts/release.mjs` runs `gh release create` without `--target`. The installers and `latest.yml` are correct; the tags and source zips are not. Builder will make the script pass `--target <HEAD>` and refuse unless HEAD equals origin/main. Moving the two existing tags is the owner's call (asked by the Chief of Staff); I do not touch them. **For my next release:** after publishing, check `git ls-remote --tags origin vX.Y.Z` against the built sha, and say so in the report.

## 2026-11-16 - Published v0.1.6

**Word:** the owner typed "release v0.1.6" in my chat. Earlier the same day "release v0.1.5.1" was refused: that version can never exist (the updater needs three-part semver), and main had no new code. Main was pushed by the Chief of Staff at dfac0db (candidate dfebea3, gate 7/7); the v0.1.6 record and notes are on main.

**Commands (17:25 PST server time)**

- Build in a fresh worktree `release-ops-v016` at dfac0db: `node scripts/bootstrap.mjs`, `npm run build:css`, `npm run build:icons`, then `npx electron-builder --win nsis --x64 --publish never -c.publish.provider=github -c.publish.owner=AnfalHaider -c.publish.repo=bunny-ai` (writes `latest.yml`, version 0.1.6).
- `npm run release -- --notes-file docs/releases/v0.1.6-notes.md` -> https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.6
- `gh release view v0.1.6` -> isDraft false; .exe 122205493, .blockmap 128558, latest.yml 345. Latest feed serves `version: 0.1.6`.

**Not checked:** an update on an invented profile; the sign-off files (hook bars me).

**Rollback:** a higher version (0.1.7) with the last good code; pulling the release is owner-only.

**Lesson:** a build leaves a regenerated `src/ui/app.css` that blocks `git switch` and that this role may not revert. Build each release in a fresh worktree at `origin/main`, and ask the Chief of Staff to assign the role there before publishing.

## 2026-11-16 - Published v0.1.5

**Word:** the Chief of Staff relayed the owner's standing order and overnight delegation (the v0.1.5 record in the releases folder). I judged that not yet a clear "release v0.1.5", held, and asked. The user then answered "Publish now" in my chat, which I took as the word for v0.1.5.

**Commands (reported before running, 14:35 PST server time)**

- `git switch --detach origin/main` -> 73d3bef (candidate 2892fa4)
- `node scripts/bootstrap.mjs` -> ok
- `npm run dist` -> installer and blockmap, but **no `latest.yml`** in a worktree. Fix: `npx electron-builder --win nsis --x64 --publish never -c.publish.provider=github -c.publish.owner=AnfalHaider -c.publish.repo=bunny-ai` wrote it (version 0.1.5).
- `npm run release -- --notes-file docs/releases/v0.1.5-notes.md` -> published https://github.com/AnfalHaider/bunny-ai/releases/tag/v0.1.5
- `gh release view v0.1.5` -> isDraft false; assets .exe 122204719, .blockmap 128613, latest.yml 345. The latest download URL serves `version: 0.1.5`.

**Not checked:** the sign-off files (a hook bars every role but the Chief of Staff from that folder); an update on an invented profile.

**Rollback:** forward fix, a higher version (0.1.6) with the last good code; pulling the release is owner-only.

**Lesson:** `npm run dist` writes `latest.yml` only in the main checkout; in a worktree pass the publish flags above, or `release.mjs` stops on a missing file.

## 2026-11-16 - Start-up: queue check and the release recipe

**What I did**

- Applied the worktree setup. `node scripts/bootstrap.mjs` stopped at `scripts/build-css.mjs` ("C:\Program Files" split at the space). Chief of Staff says Builder fixes it as B-1; `src/ui/app.css` is tracked, so nothing is missing. Role set with `bootstrap role release-ops`; the kit check (R14) waits for a session restart.
- My rows on the board: none. Sign-off grid: empty (`docs/signoffs/` holds nothing). Signed off and not yet live: **nothing**, so there is no batch to propose.
- Live today: 0.1.4 (tag `v0.1.4`, installed copies auto-update).
- **0.1.2, 0.1.3 and 0.1.4 predate the family and have no `docs/releases/` records.** The owner's words for them were typed in the main session. Records are never reconstructed for them (Chief of Staff, 2026-11-16). The Librarian holds this as a question for the owner.

**Release recipe (0.1.x), from `scripts/release.mjs`**

1. Only on the owner's "release <scope>" (typed in this chat, or relayed under 7E with words, date, question as asked, shas in dev order, pasted pre-release check, full sign-off row).
2. Dry run first, in a release worktree: merge the named batch, `node scripts/gate.mjs`, list migrations. Ask for the word and the check in ONE message.
3. Raise `version` in `package.json` (installed copies only update to a higher number), then `npm run dist`.
4. Write the record: `node .bootstrap/bin/bootstrap.mjs release v<version> --shas ... --words "..." --question "..." --said-at "..." --check <gate output file>`. It lands in `docs/releases/`; `release.mjs` refuses without a file containing `scope: v<version>`.
5. Report the exact `npm run release` text before running it, then run it. It refuses unless the role is release-ops or hotfix, `dist/` holds the installer, `.blockmap` and `latest.yml` for that version, and the record exists. Log it afterwards with server time.
6. Watch: check the release on GitHub (assets present, `latest.yml` version), then "Check for updates" in an invented-profile copy (`BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`), never the owner's real profile. Merge back, update the board and this log.
7. Never run `dist/Bunny-AI-Setup-*.exe //S` over the owner's install.

**Rollback note (0.1.x) - every release names it**

- Installed copies update only to a *higher* version, so a bad release is not undone by going back a number. The rollback is a **forward fix**: publish a higher version (for example 0.1.5) whose code is the last good one, through the same recipe with a fresh owner word.
- If the owner wants a bad release pulled from the feed at once, `gh release delete/edit` is owner-only; I report the exact command and the owner runs it. Copies that already updated stay on the bad build until the higher version arrives.
- A hotfix (cloud Hotfix role, owner's "apply") is the quick path when it is urgent; Release Ops does not do hotfixes.

**Lesson:** no lesson yet (nothing released).
