---
piece: w4-9
role: qa
sha: 375d368
verdict: PASS
date: 2026-11-17
---

W4-9 at 375d368 (the setting is now on the release-candidate line, with the blur fix from my note). e2e/w49-walk.mjs 47 of 47 (API accepts 10 to 600 and refuses everything else with 400 and nothing saved, survives a restart, damaged file falls back to 30, real timings 10.0 / 20.0 / 30.0 s and 20 s for a reasoning model and for silence, the chat route ends after about 10 s with the saved wait) and e2e/w49-ui-walk.mjs 87 of 87 (the Settings row at 1280 and 390 px, light and dark). BLUR FIX: Custom 45 typed, then the preset 15 chosen while the number box still has focus: 15 stays saved, the select shows 15 and the note says 15 (before, the hidden box saved 45 back); presets chosen one after another after a Custom value all stick. No page errors.
