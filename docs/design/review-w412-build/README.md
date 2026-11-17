# W4-12 ("Bunny asked" card: answered, unanswered, Send stays on): build c2da6a8

Design, 2026-11-17. Verdict: **PASS**, with one suggestion.

How shot: build `c2da6a8` extracted with `git archive`, run on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). A small invented model server on this computer was added as a custom provider and scripted to ask "Which colour should the header be?" (choices Green, recommended, and Blue). Real server, real page, real card code; nothing stubbed. Light and dark, 1440 and 390: `shots/{waiting,answered-click,answered-typed,unanswered}-{light,dark}-{d,m}.png`, text and states in `shots/log.txt`. Not covered: contrast not measured (UNKNOWN); the limit-check card ("the same step three times in a row") was not re-shot (same card code, covered by the build's own tests); the placeholder of the message box while a card waits was not checked.

## Matches what was asked
- **Waiting card:** eyebrow "Bunny has a question", the choices as real buttons with reasons, a type-your-own box, Send and Skip. Send in the message box stays on while the card waits (`send disabled=false`, Stop visible); typed text sits in the box. Bunny's working line says "Waiting… (arms crossed)".
- **Answered by a click:** the card turns calm ("Bunny asked"), choices become a flat record, the chosen one outlined, and one line "You answered: Green". Reply follows.
- **Answered by typing in the message box:** "You answered: Something warm, like orange", no choice outlined (correct: none was chosen), reply follows. Works the same at 390 px.
- **Unanswered (window reloaded while it waited):** choices dimmed (opacity 0.55) and no longer buttons (button count 0), then "Not answered" and the note "Bunny stopped waiting (the window was closed or reloaded, or nobody answered in time), so this card can no longer be answered. Tell Bunny what you want in the message box." Readable in light and dark and on the phone (note wraps to four lines at 390 px).

## Suggestion, not blocking
While a card waits, the message box has no hint that typing there answers the card (only the box inside the card says "Or type your own answer…"). A placeholder such as "Type your answer, or pick one above" would say so. Say if you want a drawing.
