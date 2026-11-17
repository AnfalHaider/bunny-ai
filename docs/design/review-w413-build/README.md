# W4-13 slice 2 (model picker UI): build 856d058 against drawing 20f9c41

Design, 2026-11-17. Verdict: **FAIL** (one visible defect against "one row per model", two gaps to confirm).

How shot: build `856d058` extracted with `git archive`, served on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). The fake profile has no models, so `/api/models` was answered with an invented list in the browser (models Falcon Flash, Otter 3 Coder, Heron Mini, Marten Pro, Lynx Lite, Sable 7B on invented providers Harbor, Meadow, Quill, Fjord; fields as the real route sends, including `freeKind`). Real page, real picker code. Light and dark, 1440 and 390 wide: `shots/{open,filters,freeonly,free-harbor}-{light,dark}-{d,m}.png`; row text and counts are in `shots/log.txt`. Not covered: contrast not measured (UNKNOWN); the real server's model list; details panel, ordering, Thinking, Favourites and Recent, automatic switch (slices 2b and 3, out of scope).

## Matches the drawing
- All models: one row per model with providers as tags in order, Free (Meadow) before Free daily (Harbor), then the paid tag (Quill) untagged. Same in dark and on the phone.
- Filters button opens a strip with provider chips and "Free only (Free and Free daily)"; the button shows "Filters · 2"; "Clear filters" appears; count line "4 of 6 models", "2 of 6 models"; Free only plus provider combine with AND; Auto and "Best for" hide while filtering.
- Phone: strip wraps, rows and tags fit at 390 px; dark theme readable.

## Changes needed
1. **"Best for Chat" still repeats models.** With invented data it lists Falcon Flash twice and Otter 3 Coder twice (one per provider), and the section is built from per-provider rows (`rankModels(...)` then `pickerItem(m,'best')`, chat.js about line 477). The drawing shows one row per model everywhere, tags carrying the providers. Fix: collapse the best-for list by model id and give those rows the same tags as All models; re-shoot.
2. **Filters strip is missing Can-do chips and Sort** (Recommended, Name, Context size), both in the drawing and not named as out of scope. Either add them or tell Design they move to slice 2b, and I will mark them so.
3. **Context size sits on a sub-line** ("128,000 tokens · id") instead of the right-hand side with "Default ›". The "Default ›" link belongs with the details panel (2b); the context placement is already with Builder A. Not blocking by itself.
4. Possible, not confirmed: every invented model shows "· Speech" in its sub-line. This may come from my invented data lacking ability fields; check with a real model list before treating as a bug.

Sign-off: FAIL until item 1 is fixed and item 2 is settled; send the new sha.
