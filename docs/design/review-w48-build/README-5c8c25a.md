# W4-8 quick-ask bar: re-check at 5c8c25a against drawing 1827a0d

Design, 2026-11-17. Verdict: **PASS** (supersedes the FAIL at 304e71a; earlier notes are in README.md).

Shot again from the extracted build `5c8c25a` at the real window size (700 x 300), light and dark, every state: `shots/bar-{empty,typing,menu,chip,send,err-shot,err-open}-{light,dark}.png`; measurements in `shots/log-5c8.txt`. The same stand-in for the two bridge calls as before. Not tested: the real Electron window, the shortcut, the tray, a real screen capture.

- **The + menu fits:** body 0 to 300 (was 0 to 115); menu 71 to 138; both lines of "Add a screenshot" visible.
- **"Opening Bunny…"** is normal text colour with a small accent spinner; under reduced motion the animation is `none`. While sending the send button turns grey (disabled) instead of staying dark as drawn: accepted.
- **Amber only for the two real problems** ("Bunny could not take a screenshot.", "Bunny could not open."): rgb(180,83,9) light, rgb(233,173,82) dark.
- **"Add a file…"** moved to v0.1.9 by the Chief of Staff, so it is no longer a gap.
- **Contrast, measured** (WCAG ratio from the computed colours against the bar's own surface; not an audit of every pixel): text 16.27 light / 12.65 dark; hint and placeholder 5.09 / 6.14; bunny mark 5.70 / 5.79; chip text 15.08 / 11.48; send icon on the dark button 16.27 / 13.81; "Opening Bunny…" text 16.27 / 12.65 and spinner 5.70 / 5.79; problem line 5.02 / 7.50. All are at least 4.5:1 for text and 3:1 for the mark and spinner. The disabled grey send button was not measured.
