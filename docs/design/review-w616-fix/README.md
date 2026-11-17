# W6-16 "Only in:" rows: fix at 23185c5 (supersedes the FAIL at 795a8a2)

Design, 2026-11-17. Verdict: **PASS**.

How shot: build `23185c5` (branch `claude/builder-b-w616-ui`) extracted with `git archive`, invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). One invented skill ("release-notes") and one remote connector ("Docs search"), each set through the real "Only in a folder…" and "Add a folder" buttons to two empty folders on this computer: `client-site` and `my-long-project-folder-name-for-wrapping`. Customize shot as the embedded page at 800 px (the Settings pane), 390 px (phone) and 1280 px (wide), light and dark: `{connectors,skills}-{light,dark}-{d,m,w}.png`, measurements in `log.txt`.

- **Defect 1 (scope line ran into the Type column): fixed.** At 800 px the row is now a one-column card (a single 734 px column), the scope line sits under the name inside the card; measured: scope inside the row, no overlap with any other cell, no page overflow, in every combination. At 1280 px the table stays a table (columns 632 / 112 / 176 / 260 px) and the scope line sits in the wide name column, clear of Type.
- **Defect 2 (folder name cut off): fixed.** The whole text "Only in: client-site, my-long-project-folder-name-for-wrapping" is shown at 800 and 1280 px on one line; on the phone it wraps to two lines ("…my-long-project-folder-" / "name-for-wrapping"); never an ellipsis (`labelClipped: false` everywhere). Then "Add a folder" and "Everywhere" sit below.
- Light and dark read the same; the connector row (Test, Trust read-only labels, switch, Remove) now sits in the card below the name, with the status.

Not covered: a plugin row with its scope, the real folder picker in the desktop app, more than two folders. The skill name no longer wraps in a narrow column (it has the card width now).
