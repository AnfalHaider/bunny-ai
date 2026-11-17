# W4-12: re-check at bcca328 (supersedes c2da6a8)

Design, 2026-11-17. Verdict: **PASS**.

`git diff --stat c2da6a8 bcca328` touches only `src/server/app.js`, `src/server/chat.js` and `e2e/cards.spec.js`; `src/ui` is unchanged, so the cards drawn and checked at c2da6a8 (README.md in this folder) look the same. The new behaviour is visible in one place, so I shot it: on the repeated-step card, typing "yes, but skip the last step" in the message box.

How shot: build `bcca328` extracted with `git archive`, invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after), invented scripted model server as a custom provider; real page and server. Light and dark, 1440 and 390: `shots/limit-{waiting,typed}-{light,dark}-{d,m}.png`, text in `shots/log-bcca.txt`.

- Waiting card: "Bunny has a question", "I have run the same step (update_tasks) three times in a row. Keep trying, or stop here?", Stop here (Recommended), Keep going, Send, Skip.
- After typing: the card turns calm and says "You answered: yes, but skip the last step" (the person's own words, no choice outlined), and Bunny carries on ("Finished after all."). The model's next request carried those words ("The person answered your question (...): yes, but skip the last step"), which is the Security fix.
- Same on the phone and in dark.

Not covered: contrast not measured this round; the earlier checks of the unanswered card and the click answers stand from c2da6a8 since the UI files are identical.
