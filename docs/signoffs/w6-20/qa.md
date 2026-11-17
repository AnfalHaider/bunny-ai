---
piece: w6-20
role: qa
sha: 375d368
verdict: PASS
date: 2026-11-17
---

W6-20 at 375d368 supersedes my FAIL at 304e71a; finding W620-1 is fixed. e2e/w620-walk.mjs 13 of 13, invented profile, real server and a scripted model. A picture of 900 KB, 1.3 MB (the size that used to hang for 90 s) and 7 MB all reach a model that can see; a picture over 12 MB (13 MB): the window gets 413 straight away, the waiting reply is told at once (57 ms, not 90 s) The picture from the browser panel is too large (over 12 MB) to send and no picture is sent, and the reply finishes; an answer posted to a request that is not waiting is still 404. Still fine: a model that cannot see is told to work from the text, no vision field sends the picture, JPEG, non-image and empty answers are ignored, the saved chat keeps the screenshot as a stored attachment, a second message works.
