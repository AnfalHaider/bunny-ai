---
piece: release-0.1.8
role: librarian
sha: a6afcf5
verdict: PASS
date: 2026-11-17
---

Librarian re-stamp of release-0.1.8 at a6afcf5 (supersedes e028d3b). Changes since e028d3b: CSS only (src/ui/app.css, docs/design/bunny-app-bindings.css, bunny-design-system.css): the --ok-text and --warn-text tokens (light and dark), the wait-row rules and the palette is-active selector. The notes on claude/release-0.1.8-rc2 (b20ff43, 4d342ea, 4be4e86) have the same content as the f8fb042 notes I checked, with the wait-time line and the two plans-file fixes; diff of the notes and the two plans files against f8fb042 shows no change. Each line was checked at e028d3b (see the earlier release sign-off note); the CSS change does not alter any line. O7: the settings-wait.png picture is with Design and was not checked by me against the restored wait-row rules. Caveat (unchanged): the 12 MB browser-screenshot line rests on W6-20, which QA failed at 304e71a (screenshots over 1 MB); the 12 MB fix is 375d368, after that failure; I could not see a QA re-pass for it in the history I can read. QA or the Chief of Staff must confirm W6-20 before release.
