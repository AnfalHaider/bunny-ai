---
piece: w5-7
role: qa
sha: 2c29444
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at c1b4c18. At 2c29444 (autoUpdate and fallbackWhenBusy window-only) e2e/w57c-check.mjs, desktop server with a stand-in preload bridge, 4 of 4 PASS. The sweep of the real Settings screen (21 switches and 18 menus flipped, 35 saves) still has no refused save, including the two switches that now need the window: autoUpdate and fallback when busy save through the window and persist; the six switches Tech Lead found still save; transcript view Normal, Thinking and Verbose survive a reload. HTTP with the page token: PUT autoUpdate and PUT fallbackWhenBusy are each 403 Change this in Bunny's window. and change nothing, and a mixed write (theme plus autoUpdate) is refused as a whole (403); the same two keys through the window answer 200 and save. A made-up key is still 400. Unit tests at 2c29444: 606 pass, 0 fail (one earlier run had a single failure, the load-sensitive search timing test LA-2, which passes 2 of 2 alone). Earlier results stand (26 protected writes 403 over HTTP, real screens work through the bridge with 0 raw protected writes, question card 403 over HTTP, computed git argument asks under a Deny). Not exercised: the real Electron preload and IPC. Gate not run by QA.
