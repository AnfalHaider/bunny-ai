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
| 1 | 2026-11-12 | The feature parity tally is 72 of 74. The two open rows are **computer use** (needs OS-level control and an entitlement) and **plugins/marketplaces** (would mean running third-party code this app does not run). Keep them open, or take one on? | Keep them open. Both are the only rows that would make Bunny AI run code or drive the machine it runs on; everything else the reference app is known for is built and tested. | |

## OPEN

| Id | Title | Risk | Owner session | Claimed (session, date) | State | Links |
|---|---|---|---|---|---|---|
| S-1 | Local API: Host/Origin/token check, real confirm for local connectors | HIGH | Builder (owner's go: "Yes, S-1 first", typed in the Security session, 2026-11-16; question: "Approve S-1 (local API caller checks) as the Builder's first job?") | Security, 2026-11-16 | Filed | docs/security/2026-11-16-baseline-0.1.4.md |
| S-2 | Updater fails closed without checksum; signing decision | MEDIUM | Builder + owner | Security, 2026-11-16 | Filed | same |
| S-3 | Secret store: entropy; agent tools refuse secrets folder (check first) | MEDIUM | Builder | Security, 2026-11-16 | Filed | same |
| S-4 | Import: lower cap or stream; reject before reading | MEDIUM | Builder | Security, 2026-11-16 | Filed | same |
| S-5..S-7 | move_to_new_chat/memory import confirm; secretStore cipher check + pinned powershell; updater temp folder | LOW | Builder | Security, 2026-11-16 | Filed | same |
| S-8 | 6 moderate audit findings accepted (dev-only); do not downgrade electron-builder | LOW | Security | Security, 2026-11-16 | Accepted, re-check each release | same |
| G1-1 | Guard does not cover `gh release/pr merge/api` writes (publishing path) | HIGH | Builder (needs owner's go, guard) | Security, 2026-11-16 | Filed | docs/security/2026-11-16-g1-guard-review.md |
| G1-2 | Sign-off, release and `_required` records not authenticated at commit | MEDIUM | Builder (needs owner's go, guard) | Security, 2026-11-16 | Filed | same |
| G1-3..G1-5 | Hooks folder removable; git alias/--git-dir/plumbing skips; dynamic push refspec; role-by-variable | MEDIUM/LOW | Builder (needs owner's go, guard) | Security, 2026-11-16 | Filed | same |

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
