---
piece: w4-7
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W4-7 at 304e71a. Menu template checked with invented parameters (e2e/w36b-w47-walk.mjs M1-M12): misspelled word gives up to 5 suggestions then Add to dictionary then undo, redo, cut, copy, paste, select all; no suggestions gives a greyed No suggestions; Cut and Copy greyed with nothing selected; a link gives Copy link; selected text gives Copy; a blank area gives no menu; missing parameters do not crash; the actions replace the word, add the word and copy the address; labels are never HTML. Wiring text: guard() attaches the menu to every window, spellcheck true, en-US set, which is what the plan row asks (English, Windows dictionary). NOT RUN: real Electron (squiggles, the popup, the dictionary), electron was never started.
