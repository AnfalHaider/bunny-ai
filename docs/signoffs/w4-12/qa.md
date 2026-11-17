---
piece: w4-12
role: qa
sha: f6180e8
verdict: PASS
date: 2026-11-17
---

W4-12 at f6180e8 supersedes bcca328; both of my notes are fixed. e2e/w412-walk.mjs in full: 174 of 174 on the real server and the real chat page in Chromium at 1280 and 390 px, light and dark (clean second run too). NOTE 1, Skip: after Skip and the end of the reply the card says You skipped this question. with no stopped-waiting note and no Not answered, and it still says so after a reload (choices plain text, not marked unanswered); a limit-check card skipped is saved as Skipped. A reload while Bunny waits still shows Not answered and the Bunny stopped waiting note (the closed-window and timed-out wait path keep their own wording). A request that adds gone:true to a skip is saved as no answer, harmless. NOTE 2, stop words: typed yes, stop; yes, wait; yes, dont; yes, do not; yes stop; Yes. Stop.; continue, stop; go on, hold on; keep going, no; yes - not now; carry on; wait are all a stop (nothing more is run, no extra message); yes, but skip the tests; yes but stop touching the config; continue, but only read; yes, skip the tests; yes, only the docs; keep going, carefully; yes please; go on and finish all carry on and the model receives the words. Everything signed before still holds (typed and message-box answers, card clicks, reload while waiting, the model receiving typed words). MINOR, not blocking: the stop rule also catches friendly go-aheads that start with no, not or dont: yes, no problem; yes, dont worry about it; continue, dont stop; yes, not a problem; go on, no need to ask all STOP (the safe direction, the person can say it again); and continue? no, stop (a question mark before the stop) still carries on. Not run: the 30 minute wait itself.
