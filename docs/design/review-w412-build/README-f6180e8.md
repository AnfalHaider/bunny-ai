# W4-12: re-check at f6180e8 (supersedes bcca328)

Design, 2026-11-17. Verdict: **PASS**.

The only UI change since bcca328 is one line in `src/ui/chat.js` (`answeredQuestionCard`): an answer of "Skipped" now reads "You skipped this question." instead of "You answered: Skipped". Shot on the real path: build `f6180e8` extracted with `git archive`, invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after), an invented scripted model server as a custom provider; the Skip button on the waiting card was clicked. Light and dark, 1440 and 390: `shots/skipped-{live,reload}-{light,dark}-{d,m}.png`, text in `shots/log-f618.txt`.

- Skipped card, live and after a reload: "Bunny asked", the question, both choices as a flat record with none outlined, and the line "You skipped this question." in the same place and weight as "You answered: …". It is not marked unanswered (no dimming, no "Bunny stopped waiting" note), which is right: the person chose to skip.
- Bunny carries on after it ("The person did not answer. Carry on with your best judgement and say what you assumed.").
- Same in dark and on the phone.

Not covered: contrast not measured this round; the other card states stand from c2da6a8 and bcca328 (UI otherwise unchanged).
