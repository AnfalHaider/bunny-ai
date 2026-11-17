# W4-8 quick-ask bar: build e061ce6 against drawing 1827a0d

Design, 2026-11-17. Verdict: **FAIL** (one real defect, three drift items).

How shot: build `e061ce6` extracted with `git archive`; the bar page `electron/quick-ask/bar.html` opened in Playwright at the window's real size (700 x 300) with a stand-in for the two bridge calls, light and dark; Settings page served by the build on an invented profile (`BUNNY_DATA_DIR` temp folder, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after) with a stand-in `window.bunnyDesktop`. Not tested: the real Electron window, the real shortcut, the tray, a real screenshot capture, the shell's own "shortcut taken" text (the sentence in the "taken" picture is the stand-in's). Contrast not measured (UNKNOWN). Pictures are in `shots/`: `bar-{empty,typing,menu,chip,send}-{light,dark}.png`, `settings-{on,rec,taken,off}-{light,dark}.png`.

## Matches the drawing
- Bar: same surface, border, 20 px corners, bunny mark, + button, placeholder "What do you need?", ink send button turning dark with text, hint row, screenshot chip with thumbnail and ×, light and dark.
- Settings row: name, description sentence, Change / Cancel, switch, off dims the keys, warning line in the warn colour.

## Changes needed
1. **The + menu is cut off (defect).** The window is 300 px high, but `body` is only about 115 px tall and `overflow:hidden` clips to it. Measured: body 0 to 115, menu 71 to 138. The second line of "Add a screenshot" ("Takes a picture of this screen when you choose it") and the menu's bottom edge are cut (`bar-menu-*.png`). Fix: make `html, body` fill the window (`height:100%`) so nothing inside is clipped, or open the menu upward; re-shoot.
2. **"Opening Bunny…" is drawn as a warning.** `.msg` is amber (`#b45309`) for every message, so the normal sending moment looks like an error, and amber on the dark bar is weak. Drawing: normal text colour with a small accent spinner, send button kept dark. Fix: use the normal text colour with a spinner for "Opening Bunny…"; keep amber for real problems ("Bunny could not open.").
3. **Menu has one choice, drawing had two** ("Add a screenshot" and "Add a file…"). Not a defect if files are out of this build; say so, or add the second row.
4. **Settings keys are plain words in the sentence**, not key chips beside Change. Acceptable as built; the drawing's chips are optional. I accept this one.

Colours in `bar.html` are hard-coded hex copies of the tokens (own page, `prefers-color-scheme`); fine for a separate window, but they must be kept in step by hand.

Sign-off: FAIL until items 1 and 2 are fixed; send the new sha.

## Re-check at 304e71a (2026-11-17)
`git diff --stat e061ce6 304e71a -- electron/quick-ask*` is empty: the bar files are unchanged, so both items are still open. Measured again on the extracted build at the window's size (700 x 300): menu open, body 0 to 115, menu 71 to 138, `overflow: hidden` (menu still cut off by 23 px); "Opening Bunny…" colour rgb(180, 83, 9) (warning amber), no spinner. Verdict stays FAIL at 304e71a. Fix for Builder B: `html, body { height: 100% }` (or open the menu upward) and a normal-colour "Opening Bunny…" with a small accent spinner; keep amber for "Bunny could not open." or "could not take a screenshot".
