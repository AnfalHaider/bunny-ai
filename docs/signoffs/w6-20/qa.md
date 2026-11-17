---
piece: w6-20
role: qa
sha: 304e71a
verdict: FAIL
date: 2026-11-17
---

W6-20 at 304e71a, e2e/w620-walk.mjs 9 of 10. Works: a model that can see gets the picture in its next request and the tool line says it is attached; a model that cannot see is told to work from the text; no vision field sends the picture; JPEG, non-image and empty answers are ignored and the reply finishes; the saved chat keeps the screenshot as a stored attachment; a second message in the same chat works. FINDING W620-1: a screenshot whose data is over 1 MB never reaches the model. The window posts it to the browser answer route, which reads the body with the default 1 MB limit (src/server/app.js, readBody(req) at about line 1367 in the browser route), so it is refused and the waiting chat hangs the full 90 s and ends with The browser panel did not answer in time; the picture is lost. 900 KB passed, 1.3 MB failed; a 1280 px wide capture of a photo-heavy page is about that size. Fix: read that body with a larger limit (about 12 MB) and, when it is too large, answer the waiting request with a plain too-large message at once.
