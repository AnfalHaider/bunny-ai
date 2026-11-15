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
