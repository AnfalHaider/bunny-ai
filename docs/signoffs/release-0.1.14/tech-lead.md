---
piece: release-0.1.14
role: tech-lead
sha: 5fbb7975
verdict: PASS
date: 2026-11-20
---

Final v0.1.14 at 5fbb7975211a, superseding my PASS at 0870bd2d (a0e7c55e). Range 0870bd2d..5fbb7975 reviewed: no change under src, electron, scripts or package.json. Test side only: e2e/helpers.js resetProfile and the picture start set autoContinueSteps 500, autoContinueMinutes 120, firstReplyWaitSeconds 30, fallbackWhenBusy true and code colours bunny-light/bunny-dark, which are the app's own defaults (settings.html 883, 1787-1788); settings-moves restores those defaults instead of 0 (Off); theme-apply puts the code colours back after each test; workspace waits for the sidebar to list the chat before the palette; settings-moves polls for a computed text size; pictures get a 120 s test limit and a 90 s event wait for Still working, with no tolerance changed. test/kit-next-k1 (eb3205a5) is the edit I specified: NO_HANG_MS 5000, the reason assertion added to the over-size case, the guard code unchanged. The rest is docs (release notes, plan). Evidence: the Chief's gate 12/12 at 5fbb7975 (gate-final7.txt, read by the Chief); my own scratch copy of 5fbb7975 in a folder with a space, CLAUDE_PROJECT_DIR unset, no-network preload: test/kit-next-k1.test.js 27/27. GATE-MARKS is not in this release (v0.1.15). Gate not run by me.
