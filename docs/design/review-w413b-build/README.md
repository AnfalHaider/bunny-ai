# W4-13b (Thinking in the model picker): build 61372c5

Design, 2026-11-17. Verdict: **PASS**, one deviation from the drawing accepted.

How shot: build `61372c5` (branch `claude/builder-a-w413b`) extracted with `git archive`, invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). `/api/models` answered in the browser with four invented models on real provider ids (the Thinking choice depends on the id): `openai` (shown as "Harbor"), `cerebras` ("Meadow"), `nvidia` ("Quill"), `google` ("Fjord"); the names are invented, disclosed. Real page and picker code. Light and dark, 1440 and 390: `shots/thinking-{default,high,two-levels,hidden}-{light,dark}-{d,m}.png`, readouts in `shots/log.txt`.

- **Known provider (openai):** Details shows "Thinking" with chips Default, Low, Medium, High; Default is pressed at first (accent outline); choosing High moves the outline (readout `High:true`).
- **Two-level provider (cerebras):** chips Default, Low, High only.
- **Provider whose field is not known (nvidia):** no Thinking block at all (0 groups, 0 labels); the Details panel just ends at the favourites button. No dead control.
- Same on the phone and in dark; the chips sit inside the panel and nothing overflows.

Deviation, accepted: the drawing (`docs/design/review-w413-final/index.html`) had Default / None / Thinking. The build has Default / Low / Medium / High, no "None", and hides the block for unknown providers. Builder's reason (some models cannot be switched off) is sound; the drawing's "None" was wrong for those. The row link in the drawing ("Default ›" showing the current choice) is not in the build; the choice shows in Details only. Fine for now.

Re-check on the release candidate 88b6082 (`shots-cand/`, same four invented models, desktop and phone, light and dark): same result: Default pressed first, High moves it, Cerebras shows three chips, the unknown provider shows none. PASS at 88b6082.

Not covered: that the chosen level really goes to the provider, and the retry without it when a model refuses (server side; the build's own tests cover it, I did not send a message); contrast not measured (UNKNOWN).
