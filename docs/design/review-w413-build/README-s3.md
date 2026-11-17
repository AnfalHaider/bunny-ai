# W4-13 slice 3 (provider switch line and live line): build 02150b8 against drawing 20f9c41

Design, 2026-11-17. Verdict: **PASS**, with two notes.

How shot: build `02150b8` extracted with `git archive`, run on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, all stopped after). Two invented OpenAI-compatible servers on this computer were added as custom providers: Harbor always answers "429 busy", Meadow answers after about 7 seconds. In the page Falcon Flash was picked (Harbor first) and a message sent, so the real server fallback, the real status line and the real note ran; nothing was stubbed. The offline test models all look alike, so only their displayed names were changed in the page (Falcon Flash, Otter 3 Coder, Heron Mini); ids, providers and the chat path are untouched. Light and dark, 1440 and 390: `shots-s3/{live,note}-{light,dark}-{d,m}.png`, text and colours in `shots-s3/log-s3.txt`.

## Matches the drawing
- **Live line** while Harbor fails and Meadow works: "Harbor is busy. Trying Falcon Flash on Meadow…". Desktop: dim text in the header beside the chat title; phone: dim line above the composer. The bunny working line carries on as before.
- **The note** under the reply's start: "↪ Switched to Falcon Flash on Meadow: Harbor was busy (rate limit or overloaded)." One amber line (`--warn`: rgb 192,122,18 light, 233,173,82 dark), small text, no box, not red. It wraps cleanly on the phone. The reply "Here is the answer from Meadow." follows.
- It switches to the same model on the next provider, as drawn; nothing is silent.

## Notes (not blocking)
1. **Wording of the reason.** Drawing: "Harbor used up today's free limit." Build: the generic "was busy (rate limit or overloaded)", because the server has one rate-limit reason. Fine for now; if a "Free daily" provider runs out, a later change can say "used up today's free limit".
2. **The "no provider has X left" variant was not shot** (my invented providers both list every model, so I could not make a model with one provider). From the code (`model.switchedModel` in `src/ui/i18n-agent.js:18`) the sentence would read "Switched to Otter 3 Coder: no provider has Falcon Flash left (Harbor was busy (rate limit or overloaded))." with brackets inside brackets. Suggest dropping the inner brackets: "...left; Harbor was busy (rate limit or overloaded)." Needs a look when it can be reproduced.

Not covered: contrast not measured (UNKNOWN; by my own arithmetic the light-theme amber on the cream page is near 3:1, the same token other notes use); the real Harbor-style free-limit message.
