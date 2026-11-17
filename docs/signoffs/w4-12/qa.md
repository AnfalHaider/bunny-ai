---
piece: w4-12
role: qa
sha: bcca328
verdict: PASS
date: 2026-11-17
---

W4-12 at bcca328 supersedes my PASS at c2da6a8. e2e/w412-walk.mjs in full: 140 of 144 on the real server and the real chat page in Chromium at 1280 and 390 px in light and dark; the four misses are the Skip finding below, not part of this change. New for Security's LOW fix (11 rows): a typed yes, but skip the tests on the limit-check card carries on AND the next request to the model holds a user message The person answered your question (the question text): yes, but skip the tests. Plain keep going (also Keep going!, KEEP GOING., with spaces) and a click on Keep going carry on with no extra message; a click on Keep going with a note typed in the card carries on and the model gets the note; a click on Stop here with a note, typed no stop, and Skip with words typed all stop and add nothing; markup, quotes, backticks and braces pass through as plain text in one message; a very long answer is cut to 200 characters of the words typed (whole message 326 characters); the saved card record still shows what was typed; continue, but only read, do not write is passed on too. Everything signed at c2da6a8 still holds: reload while Bunny waits gives the saved card that says Bunny stopped waiting with dimmed plain-span choices that do nothing, and the message box then works as a normal message; typed answers, message-box answers and card clicks. STILL OPEN for Builder A, not blocking: after Skip is pressed the saved card is drawn as Not answered with the Bunny stopped waiting note (the saved answer of a skipped card is empty); minor: words that start with a go-ahead word such as yes, stop still carry on, but the model now receives those words and can act on the stop. Not run: the 30 minute wait itself.
