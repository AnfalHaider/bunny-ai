# Board

<!-- One shared file, edited one row at a time as plain docs commits. Claim a row (session + date) before any code. -->

## Ownership map

| Area | Owning session |
|---|---|
| | |

## QUESTIONS for the owner

<!-- Numbered, dated, each with a recommendation. The answer is written in place: the owner's exact words + date. -->

| # | Date | Question | Recommendation | Owner's answer (exact words, date) |
|---|---|---|---|---|
| 1 | 2026-11-12 | The feature parity tally is 72 of 74. The two open rows are **computer use** (needs OS-level control and an entitlement) and **plugins/marketplaces** (would mean running third-party code this app does not run). Keep them open, or take one on? | Keep them open. Both are the only rows that would make Bunny AI run code or drive the machine it runs on; everything else the reference app is known for is built and tested. | _Not the owner's answer._ Answered by research, awaiting owner's acknowledgement: the premise is out of date. Both rows (6.7 Computer use, 6.10 Plugins and marketplaces) are marked done in `docs/features.js:111,114`. Not closed here; the owner closes it. (Recorded by Librarian, 2026-11-16, relayed from the Chief of Staff.) |

## OPEN

| Id | Title | Risk | Owner session | Claimed (session, date) | State | Links |
|---|---|---|---|---|---|---|
<<<<<<< HEAD
| B-1 | bootstrap.mjs: quote-safe spawn (shell only for .cmd), drop unused imports | LOW | builder | builder, 2026-11-16 | claimed | `claude/builder-efa9a9` |
| S-1 | Lock the local API to Bunny's own pages (Host, Origin, per-launch token) per Tech Lead notes 40e4230 | HIGH | builder | builder, 2026-11-16 | built at ca01243, gate 7/7; awaiting QA + Security + Tech Lead review | `claude/builder-efa9a9`, `docs/plans/S-1-build-notes.md` on claude/tech-lead-86cf31 |
| D1 | Design review 0.1.4: greeting + Add a provider button, phone Settings pill row, custom provider form first, phone Automation buttons full width, purple bunny (notes 2a744a9) | LOW | builder | builder, 2026-11-16 | built, gate 7/7; shots in docs/design/review-0.1.4/built; awaiting Design + QA | `claude/builder-efa9a9` |
| G-1 | Guard gaps B, A1-A5, C, D, E per Tech Lead a012c6f, built in staging `scripts/guard-next/` (Chief of Staff copies into `.bootstrap/` + `.githooks/` after review) | HIGH | builder | builder, 2026-11-16 | claimed; owner go in AGENTS.md (Guard-gap go) | `claude/builder-efa9a9`, `scripts/guard-next/`, `test/guard-next.test.js` |
=======
| D1-design | 0.1.4 screens design review (8 screens, today beside proposed) | LOW | design | design, 2026-11-16 | Approved by the Chief of Staff under the delegation; built as D1 (2cfeec5); was: Artifact ready, nothing built | `docs/design/review-0.1.4/index.html`, `docs/memory/logs/design.md` |
>>>>>>> origin/claude/design-343143

## SIGN-OFF GRID

<!-- Mirrors docs/signoffs/<piece>/<role>.md (the pre-push hook reads those files, not this table). -->

| Piece | sha | QA | Design | Tech Lead | Security | Librarian | Chief of Staff | Date |
|---|---|---|---|---|---|---|---|---|

## RELAYS

<!-- Each relayed owner word: words, question as asked, scope, date. The record itself is docs/releases/<date>-<scope>.md. -->

| Date | Word | Owner's exact words | Question asked | Scope (shas) | Record |
|---|---|---|---|---|---|

## DONE

| Id | Title | sha | Verified live (date) |
|---|---|---|---|
| 1 | feature parity: 74-row tally, 72 done and covered by a test; 204 unit tests and 62 browser tests pass | working tree | 2026-11-12 (`docs/STATUS.md`, `docs/FEATURE-TALLY.md`) |
