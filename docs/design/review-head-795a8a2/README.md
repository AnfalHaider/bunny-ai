# v0.1.9 candidate head 795a8a2 (origin claude/release-0.1.9): Design review

Design, 2026-11-17. L-1, W4-13b, W4-8b chip and W6-24 menu: **PASS**. W6-16 "Only in:" rows: **FAIL** (two layout defects below).

How shot: head `795a8a2` extracted with `git archive`, run on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). Invented seed: one skill ("release-notes"), one remote connector ("Docs search", example.com, never reachable), two empty folders on this computer ("client-site", "my-long-project-folder-name-for-wrapping"). Desktop = the Settings pane width (800 px) and 1280/1440 where the full window was needed; phone = 390 px; light and dark. Pictures and `log.txt` are in this folder.

## L-1: PASS (supersedes the check at 88b6082)
Permission rules heading, switch, lists, add row and Try box share one left edge (41 px desktop, 37 px phone); Privacy labels 17 px in; Providers footnote 12 px below the list; no overflow. Open and not blocking: on the phone the Permission rules text is 4 px left of the other rows (37 against 41, `src/ui/app.css:2068`, `--sp-6` should be `--sp-8`).

## W4-13b: PASS
Default pressed first, High moves it, Cerebras three chips, unknown provider none; desktop and phone, light and dark (`think-*`).

## W4-8b chip: PASS
Image chip with preview and name, long PDF name on one line, the 8 MB line in amber, no overflow, light and dark (`bar-*`). Real Electron window and dialog not tested.

## W6-24 menu at narrow widths: PASS
Browser panel, ⋯ menu opened at 1280, 700, 500, 390 and 320 px wide: the menu stays inside the window each time (right edge 8 px from the window at the narrowest), and Esc closes it and puts the focus back on the ⋯ button (`w624-menu-*.png`, `log.txt`). Not tested: the real Electron views, and a page loaded in a tab.

## W6-16 "Only in:" rows in Customize: FAIL
The rows show the scope and set it (Only in a folder… asks for a folder, then "Only in: client-site", Add a folder, Everywhere), and the phone reads well. Two defects on the desktop-width pane (800 px, which is what the Settings window shows at 1280):

1. **The scope line runs into the next column (Connectors).** `w616-connectors-light-d.png`: "Only in: client-site" ends against "Remote" (the Type column) and "Add a folder" / "Everywhere" stack under it; the name column is only about 85 px wide, so the URL shows as "https://exam…". Cause: `.cz-row` grid is `minmax(0,1fr) 150px 140px auto` (`docs/design/bunny-app-bindings.css:493`, `src/ui/app.css:1456`), and a connector's last column (Test, Trust read-only labels, switch, Remove) takes about 330 px, leaving the first column almost nothing; the scope node (`.cz-scope`, `bindings.css:1473` area, `app.css:1473`) is a flex row that does not shrink with its column. Intended fix: use the card layout (`app.css:1488-1491`, one column, bordered card) from 900 px down, not only at 560 px, so it covers the Settings pane; or give the first column `minmax(220px,1fr)` and let the actions wrap. Either way `.cz-scope` gets `min-width:0; max-width:100%`.
2. **The folder name is cut off, so you cannot tell which folder (Skills desktop, and the phone).** `w616-skill-light-d.png` shows "Only in: my-l…"; the phone shows "Only in: my-long-project-folder-name-for-…". Cause: the label is a `<small>` inside `.cz-text`, so `.cz-text small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }` (`bindings.css:506`, `app.css:1469`) applies to it. Intended fix: `.cz-scope-label { white-space: normal; overflow: visible; text-overflow: clip; }`, so a long folder name wraps (the line already has `overflow-wrap: anywhere`), and several folders stay readable. The full path is in the tooltip, which a phone cannot show.

Also seen, pre-existing and not part of this piece: on desktop the skill name "release-notes" wraps in the same narrow column.

Not covered: a plugin row with its scope, two or more folders on one item (only one folder per item was set), the real folder picker in the desktop app.
