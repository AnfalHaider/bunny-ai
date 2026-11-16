# Release Ops - session log

Newest entry on top. Only this session writes this file.

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
