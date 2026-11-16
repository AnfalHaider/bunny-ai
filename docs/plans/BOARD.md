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

| 2 | 2026-11-16 | Auto mode middle way: in Auto, still ask before Bunny creates a tool, a schedule that changes things, or a local connector? | Yes: these outlive the chat, and text read from a web page or file could otherwise create one unasked | "Yes, still ask" (typed in the Chief of Staff's chat, 2026-11-16) |
| 3 | 2026-11-16 | Go for the 0.1.6 HIGH items: guard round G1-1..5, permission rules by command (W2-7), MCP sign-in connectors (W3-6)? | Yes to all three, built in that order after lane A | "Go on all three" (typed in the Chief of Staff's chat, 2026-11-16; question as asked: "Go for the three HIGH items: guard fixes, permission rules by command, sign-in connectors?") |

## OPEN

| Id | Title | Risk | Owner session | Claimed (session, date) | State | Links |
|---|---|---|---|---|---|---|
| B-1 | bootstrap.mjs: quote-safe spawn (shell only for .cmd), drop unused imports | LOW | builder | builder, 2026-11-16 | claimed | `claude/builder-efa9a9` |
| S-1 | Lock the local API to Bunny's own pages (Host, Origin, per-launch token) per Tech Lead notes 40e4230 | HIGH | builder | builder, 2026-11-16 | built at ca01243, gate 7/7; awaiting QA + Security + Tech Lead review | `claude/builder-efa9a9`, `docs/plans/S-1-build-notes.md` on claude/tech-lead-86cf31 |
| D1 | Design review 0.1.4: greeting + Add a provider button, phone Settings pill row, custom provider form first, phone Automation buttons full width, purple bunny (notes 2a744a9) | LOW | builder | builder, 2026-11-16 | built, gate 7/7; shots in docs/design/review-0.1.4/built; awaiting Design + QA | `claude/builder-efa9a9` |
| G-1 | Guard gaps B, A1-A5, C, D, E per Tech Lead a012c6f, built in staging `scripts/guard-next/` (Chief of Staff copies into `.bootstrap/` + `.githooks/` after review) | HIGH | builder | builder, 2026-11-16 | claimed; owner go in AGENTS.md (Guard-gap go) | `claude/builder-efa9a9`, `scripts/guard-next/`, `test/guard-next.test.js` |
| D1-design | 0.1.4 screens design review (8 screens, today beside proposed) | LOW | design | design, 2026-11-16 | Approved by the Chief of Staff under the delegation; built as D1 (2cfeec5); was: Artifact ready, nothing built | `docs/design/review-0.1.4/index.html`, `docs/memory/logs/design.md` |
| S-1 (filed) | Local API: Host/Origin/token check, real confirm for local connectors | HIGH | Builder (owner's go: "Yes, S-1 first", typed in the Security session, 2026-11-16; question: "Approve S-1 (local API caller checks) as the Builder's first job?") | Security, 2026-11-16 | Filed | docs/security/2026-11-16-baseline-0.1.4.md |
| S-2 | Updater fails closed without checksum; signing decision | MEDIUM | Builder + owner | Security, 2026-11-16 | Filed | same |
| S-3 | Secret store: entropy; agent tools refuse secrets folder (check first) | MEDIUM | Builder | Security, 2026-11-16 | Filed | same |
| S-4 | Import: lower cap or stream; reject before reading | MEDIUM | Builder | Security, 2026-11-16 | Filed | same |
| S-5..S-7 | move_to_new_chat/memory import confirm; secretStore cipher check + pinned powershell; updater temp folder | LOW | Builder | Security, 2026-11-16 | Filed | same |
| S-8 | 6 moderate audit findings accepted (dev-only); do not downgrade electron-builder | LOW | Security | Security, 2026-11-16 | Accepted, re-check each release | same |
| G1-1 | Guard does not cover `gh release/pr merge/api` writes (publishing path) | HIGH | Builder (needs owner's go, guard) | Security, 2026-11-16 | Filed | docs/security/2026-11-16-g1-guard-review.md |
| G1-2 | Sign-off, release and `_required` records not authenticated at commit | MEDIUM | Builder (needs owner's go, guard) | Security, 2026-11-16 | Filed | same |
| G1-3..G1-5 | Hooks folder removable; git alias/--git-dir/plumbing skips; dynamic push refspec; role-by-variable | MEDIUM/LOW | Builder (needs owner's go, guard) | Security, 2026-11-16 | Filed | same |
| Q2-S1..S3 | Plan mode: browser tools skip the check; move_to_new_chat leaves Plan; connector readOnly is self-declared | MEDIUM-HIGH | Builder | Security, 2026-11-16 | Filed | docs/security/2026-11-16-q2-1-and-q2-23-review.md |
| D2-1..D2-4 | D-2 panes server: changesFor realpath containment; read only 1 MB of a file; cap diff work; .git and node_modules consistent | MEDIUM | Builder | Security, 2026-11-16 | Filed; sign-off after D2-1 and D2-2 | docs/security/2026-11-16-d2-panes-review.md |
| D2-5 | folder/check lets any token holder choose any folder, then folder/files and folder/file read the whole disk; tie 'chosen' to the native folder picker | MEDIUM-HIGH | Builder | Security, 2026-11-16 | Filed; D-2 FAIL at 5f36e04. Installed 0.1.5 walk: an unpicked `C:\Windows` gets 403 from folder/files (Chief of Staff, 2026-11-16); Security to confirm and close (W4-7) | docs/security/2026-11-16-d2-panes-review.md |
| 0.1.6 | Every remaining gap, by wave, owner and test | — | chief-of-staff | chief-of-staff, 2026-11-16 | Plan written; installed 0.1.5 walk done (all PASS but W0-4) | `docs/plans/2026-11-16-0.1.6-plan.md` (89f473b) |
| W0-4 | First-run: default model filter hides paid-provider models; picker says "No models available" | LOW | builder | chief-of-staff → builder, 2026-11-16 | Briefed, first in lane A; may ship as 0.1.5.1 | plan W0-4 |
| Lane A | W4-1 per-worktree e2e port, W2-1 regex search, W2-2 find_files, W2-3 replace_all and multi_edit, W2-4 tool lines | LOW-MEDIUM | builder | chief-of-staff → builder, 2026-11-16 | Briefed | plan Wave 2 lane A |
| Lane B | T-4 read and offer to write project instruction files (W2-5, W2-6) | MEDIUM | builder (after lane A) | — | Queued | `docs/plans/T-4-project-files-spec.md` |
| 0.1.6-design | Draw W2-8 Rewind, W2-9 worktree per chat, W2-7 permission rules, W4-5 polish | LOW | design | chief-of-staff → design, 2026-11-16 | Briefed | plan |
| W3-7 | Command sandbox on Windows: compare options, recommend one | research | researcher | chief-of-staff → researcher, 2026-11-16 | Briefed | `docs/research/2026-11-16-command-sandbox.md` (to come) |
| W2-7 · W3-6 · W5-1 | Permission rules by command; MCP sign-in connectors; guard round G1-1..5 | HIGH | builder | — | GO NEEDED from the owner | plan |

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
