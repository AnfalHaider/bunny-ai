---
piece: w5-7
role: qa
sha: c1b4c18
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 400946b, which let through a defect Tech Lead found: six settings were refused by the new unknown-key rule. e2e/w57c-check.mjs, desktop server (folderPickerOnly, invented profile), real Settings screen through a stand-in preload bridge. At c1b4c18: the six switches (charts, fallback when busy, status labels, transcript view with Normal, Thinking and Verbose, prompt suggestions, auto update) each save and persist; after a reload the transcript view still holds Verbose. SWEEP: every checkbox (21) and every menu (18) on the Settings screen was flipped, 35 saves in all, none refused with 400 (the saves went over HTTP or through the window as each setting requires); a made-up key is still refused with 400 so the rule is intact. The same check at 400946b reproduces the bug (6 saves refused: chartsEnabled, fallbackWhenBusy, statusLabels, promptSuggestions and more) so it would have caught it. My earlier walk, which did not flip these switches, missed it. Unit tests at c1b4c18: 605 pass, 0 fail. The earlier results still stand (26 protected writes 403 over HTTP, real screens work through the bridge, 0 raw protected writes, the question card and computed git argument checks); not exercised: the real Electron preload and IPC. Gate not run by QA.
