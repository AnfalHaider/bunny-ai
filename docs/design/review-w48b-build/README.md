# W4-8b (quick ask: "Add a file…" and its chip): build 3cb6368

Design, 2026-11-17. Verdict: **PASS**.

How shot: build `3cb6368` (branch `claude/builder-a-w48b`) extracted with `git archive`; the real `electron/quick-ask/bar.html` and `bar.js` opened at the real window size (700 x 300) with a stand-in for the four bridge calls (`submit`, `captureScreenshot`, `pickFile`, `dropFile`), as before. Light and dark: `shots/{menu,image,pdf,text,toobig,cancel}-{light,dark}.png`, `image-sending` and `pdf-sending`; readouts in `shots/log.txt`.

- **Menu:** two items, "Add a screenshot" (Takes a picture of this screen when you choose it) and "Add a file…" (A picture, a PDF or a text file, up to 8 MB); fits inside the window, nothing clipped.
- **Image file:** chip with a small preview and the file name, and an x to remove. **PDF and text:** the same chip without a preview (name only). A 62-character PDF name fits on one line at 700 px (no overflow).
- **Too big:** no chip, one amber line "That file is over 8 MB, so Bunny left it out." (same problem colour as the screenshot error). **Cancelled dialog:** nothing shown, as it should be.
- **Remove:** the chip goes and `dropFile` is called. **Send:** the bar sends `{kind:'file', id}` only (no file bytes through the page).
- Light and dark both read well; no overflow in any state.

Not covered: the real Electron window, the real file dialog, the 8 MB and file-type checks in the main process (stand-in only), file names longer than the bar (the chip may need to cut them; not seen), contrast not re-measured (same colours as 5c8c25a).
