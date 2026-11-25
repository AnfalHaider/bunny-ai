# README rewrite (v0.1.15): what Librarian should check

Branch claude/design-readme-v0115, cut from main 47873083. Written by Design. Pictures: only the ones already in docs/images (invented profile); no new pictures added.

## Kept from the previous README (already checked once)
Providers list and "23", Engines section and the ER-6 warning, house rules table and flowchart, documents, GitHub, Gmail/Calendar/Drive, phone devices and Chats/Everything levels, Quick ask and Search this PC, fonts, updates, release steps, privacy list.

## New or reshaped, needs a check against the build
1. "Meet me" table and "Who I'm for" bullets: summary of existing features. Check "Auto picks a model for each message" and "undo my own file changes".
2. "Problems I solve" table: each right-hand cell must be a shipped behaviour (Stop at the same step 3 times, 5 million token check, Undo, fold long code, settings kept after a restart).
3. Examples 1 to 12: the prompts are suggestions; "I do" and "You see" lines must match behaviour. Highest risk:
   - 8: scheduled task wording ("collect calendar and unread mail", "results when it runs") and that Gmail/Calendar need Google sign-in.
   - 7: "failing checks" shown for pull requests.
   - 5: "search words go to DuckDuckGo", "browser panel open beside the chat".
   - 11: "Activity ... last 500 entries or 30 days" (from the old README).
   - 12: restricted mode and "Keep N changes from the engine?" (from the old README).
4. "Phones fit" and "Tighter rows" bullets (taken from the v0.1.14 notes).
5. The "What's new" sections of the old README were removed; v0.1.14 facts live in the feature sections.
6. Test counts and the old gate sha line were removed rather than updated.

## Marked v0.1.15 (not released yet), between `<!-- V0115:begin ... -->` and `<!-- V0115:end ... -->`
office-files, engine-rule-lists, signin-open, quick-ask-dependable, project-instructions (AGENTS.md first, CLAUDE.md fallback; the Follow / Not now card), rewind, engine-switch, settings-overhaul, plus two inline callouts (quick-ask-note, examples-note). Cut any block whose build is not on the final sha. Source: docs/plans/2026-11-20-v0.1.15-plan.md and 2026-11-20-v0.1.16-direction.md.
