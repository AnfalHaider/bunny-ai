# Board

<!-- One shared file, edited one row at a time as plain docs commits. Claim a row (session + date) before any code. -->

<!-- Reconciled by the Librarian on 2026-11-18 against origin/main (d183f9c, merged into claude/librarian-v018-status). Each row is DONE with the sha that closed it, or STILL OPEN with the evidence. Checked by reading git history and the code on main; no gate or live probe was run. -->

## Ownership map

| Area | Owning session |
|---|---|
| | |

## QUESTIONS for the owner

<!-- Numbered, dated, each with a recommendation. The answer is written in place: the owner's exact words + date. -->

| # | Date | Question | Recommendation | Owner's answer (exact words, date) |
|---|---|---|---|---|
| 1 | 2026-11-12 | The feature parity tally is 72 of 74. The two open rows are **computer use** (needs OS-level control and an entitlement) and **plugins/marketplaces** (would mean running third-party code this app does not run). Keep them open, or take one on? | Keep them open. Both are the only rows that would make Bunny AI run code or drive the machine it runs on; everything else the reference app is known for is built and tested. | _Not the owner's answer._ Answered by research, awaiting owner's acknowledgement: the premise is out of date. Both rows (6.7 Computer use, 6.10 Plugins and marketplaces) are marked done in `docs/features.js:111,114` (checked on main, 2026-11-18). Not closed here; the owner closes it. |

## OPEN

| Id | Title | Risk | Owner session | Claimed (session, date) | State | Links |
|---|---|---|---|---|---|---|
| S-3 | Secret store: entropy; agent tools refuse secrets folder | MEDIUM | Builder | Security, 2026-11-16 | STILL OPEN: no built-in refusal of a secrets folder found for agent tools (`src/server/permissionRules.js` only has the user's own "never edit secrets/**" rule). No entropy change found in `src/providers/secretStore.js`. | same |
| S-5 | `move_to_new_chat` and memory import need a confirm | LOW | Builder | Security, 2026-11-16 | STILL OPEN: `move_to_new_chat` is refused in Plan mode (`src/server/app.js:1946`) and rated `own` (`src/server/agentTools.js:267`), but no separate confirm found. `POST /api/memory/import` (`src/server/app.js:960`) has no confirm step. | same |
| S-6 | secretStore: cipher read-back check and a pinned PowerShell path | LOW | Builder | Security, 2026-11-16 | STILL OPEN: `src/providers/secretStore.js:15` runs `powershell.exe` by bare name, not a pinned System32 path. No cipher read-back check found in the `set` path (`src/providers/secretStore.js:60-70`). | same |
| S-7 | Updater temp folder: a fixed, shared name | LOW | Builder | Security, 2026-11-16 | STILL OPEN: `electron/updater.js:71` downloads to `tmpdir()/bunny-ai-update` (a fixed name in the shared temp folder, no per-run folder or ACL check). | same |
| S-8 | 6 moderate audit findings accepted (dev-only); do not downgrade electron-builder | LOW | Security | Security, 2026-11-16 | STILL OPEN: `docs/security/audit-exceptions.json` (1dad4ac, signed 2026-11-18) records one advisory (GHSA-fc5q-39xc-vjpf, picomatch). The other five are not recorded. Re-check each release. | same |
| D1 | Design review 0.1.4 sign-offs | LOW | builder | builder, 2026-11-16 | STILL OPEN: the code is on main (2cfeec5, see DONE); the QA and Design sign-offs are not evidenced by the Librarian. | `claude/builder-efa9a9` |
| G1-x-sign | Guard: shell writes checked against `write_globs` (register gap 1) | HIGH | Builder (needs owner's go, guard) | Security, 2026-11-16 | STILL OPEN: `write_globs` is read only in `.bootstrap/bin/lib/flow.mjs`, `lib/policy.mjs` and `precommit.mjs`; not in `lib/shellrules.mjs` or `guard.mjs`. | `docs/plans/pending-register.md` |
| G1-y-drive | Guard: cross-drive paths treated as inside the repo (register gap 2) | HIGH | Builder (needs owner's go, guard) | Security, 2026-11-16 | STILL OPEN: no drive-letter check found in `.bootstrap/bin/lib/shellrules.mjs` or `guard.mjs`. | `docs/plans/pending-register.md` |
| SETTINGS-BRIDGE | Settings iframe reaches the desktop bridge (same-origin parent only); a plugin repo under another spelling counts as installed | HIGH | v0.1.10 Builder A | v0.1.10 plan, 2026-11-18 | STILL OPEN on main: commit 1d16eb6 is not an ancestor of `origin/main`. Lands with `claude/release-0.1.10`. | `docs/plans/2026-11-18-v0.1.10-plan.md` |
| SB-1 | IPC `isOwn` allow-lists Bunny's own page paths, never `/api/*` | HIGH | v0.1.10 Builder A | v0.1.10 plan, 2026-11-18 | STILL OPEN: `electron/main.js:63` is `url.startsWith(origin + '/')`, so every path including `/api/*` passes. | same |
| SB-2 | Print an artifact from a sandboxed srcdoc frame, never `innerHTML` into a same-origin popup | MEDIUM | v0.1.10 Builder A | v0.1.10 plan, 2026-11-18 | STILL OPEN: no sandboxed print path found on main. | same |
| QA-ANSWERS | Quick Ask answers in the bar, as drawn (Design's six recommendations) | HIGH | v0.1.10 Builder A | v0.1.10 plan, 2026-11-18 | STILL OPEN: not on main. | same |
| MODEL-CHIP | Model chip in the composer button row, opening a floating selector (phone: bottom sheet) | MEDIUM | v0.1.10 Builder B | v0.1.10 plan, 2026-11-18 | STILL OPEN: picker chips exist (`src/ui/chat.js:447`), but the composer chip and floating selector are not found on main. | same |
| GAPS-QA | QA's v0.1.9 gap list 4c, items 3 to 14 | LOW/MEDIUM | v0.1.10 Builder C | v0.1.10 plan, 2026-11-18 | STILL OPEN: not checked item by item; needs QA's list. | same |
| RUN | Unit runner (reverted in fcddf99), rebuilt on main | MEDIUM | v0.1.10 Builder C | v0.1.10 plan, 2026-11-18 | STILL OPEN: no unit runner on main. | same |
| W2-9, W6-11 | Two W6 rows carried from v0.1.9 | per row | v0.1.10 Builder C | v0.1.10 plan, 2026-11-18 | STILL OPEN: not verified; the W6 audit text is needed to tie them to code. | same |
| K-5 | Guard: git state read once per decision, false blocks, flow.json overrides from the committed copy, company-layer path, flow-editor escaping, guard/pre-commit deadlock on `scripts/kit-next/.bootstrap/policy.json`; G1-4/G1-5 review | HIGH | v0.1.10 Builder C | v0.1.10 plan, 2026-11-18 | STILL OPEN: `scripts/kit-next/` exists on main; the K-5 items are not found on main. | same |
| Q-RELEASE | Retroactive release records for 0.1.2 to 0.1.4 | LOW | owner | Librarian, 2026-11-16 | STILL OPEN: owner decision. Recommendation: no. | `docs/plans/pending-register.md` |
| B-1-owner | B-1 approval in Tech Lead's chat | LOW | owner | Librarian, 2026-11-16 | STILL OPEN: Tech Lead PASS recorded (242ef8c); the owner's approval is not recorded. | `docs/plans/pending-register.md` |

## SIGN-OFF GRID

<!-- Mirrors docs/signoffs/<piece>/<role>.md (the pre-push hook reads those files, not this table). -->

| Piece | sha | QA | Design | Tech Lead | Security | Librarian | Chief of Staff | Date |
|---|---|---|---|---|---|---|---|---|

## RELAYS

<!-- Each relayed owner word: words, question as asked, scope, date. The record itself is docs/releases/<date>-<scope>.md. -->

| Date | Word | Owner's exact words | Question asked | Scope (shas) | Record |
|---|---|---|---|---|---|

## DONE

<!-- Each row: the id, what it was, the sha that closed it, and the evidence checked on main on 2026-11-18. -->

| Id | Title | sha | Verified live (date) |
|---|---|---|---|
| 1 | feature parity: 74-row tally, 72 done and covered by a test | working tree | 2026-11-12 (`docs/STATUS.md`, `docs/FEATURE-TALLY.md`) |
| S-1 | Local API locked to Bunny's own pages (Host, Origin, per-launch token) | ca01243 | 2026-11-18: `src/server/requestGuard.js:75` refuses a request whose Origin is not the Host; ancestor of main. Security PASS recorded at 0.1.5 scope (commit 0ba80ba). |
| S-2a | Updater fails closed without a published checksum (S-UPD) | 6ac601a | 2026-11-18: `electron/updater.js:6,54-61` and the S-UPD refusal; ancestor of main. Signing decision is still S-2b. |
| S-4 | Memory import: body cap; a declared oversize body is refused before it is read | 591bf83 | 2026-11-18: `src/server/app.js:961` caps the import at 2 MB; memory guard commit on main. Lines per import capped at 150 (`app.js:964`). |
| G-1 | Guard gaps B, A1-A5, C, D, E landed in the live kit | ca50c80 (kit landing 9c5ac84, ba091a6) | 2026-11-18: commit "Land G-1" is an ancestor of main; `.bootstrap/bin/guard.mjs` present. |
| G1-1 | `gh` writes to releases, merges and the API are covered | ca50c80 | 2026-11-18: `.bootstrap/bin/lib/shellrules.mjs:212-222` (gh api method checks, releases and refs). |
| G1-2 | Sign-off and release records are authenticated at commit | ca50c80 | 2026-11-18: `.bootstrap/bin/lib/records.mjs:1` (G1-2 note). |
| G1-3 | git config, alias, include and --git-dir / --work-tree writes refused for roles that may not push | ca50c80 | 2026-11-18: `.bootstrap/bin/lib/shellgit.mjs:1,29-30,62-63`. |
| G1-4 | Dynamic push target and remote refspec set from a command refused | ca50c80 (K-1 review line) | 2026-11-18: `.bootstrap/bin/guard.mjs:149-150` refuses a remote's fetch or push refspec set from a command. Not probed. |
| G1-5 | Role read from a variable or environment is refused | ca50c80 (K-1 Security B4) | 2026-11-18: `.bootstrap/bin/guard.mjs:144` (role cannot be set through the Windows environment). Not probed. |
| Q2-S1 | Plan mode: browser tools checked (capture is an edit, refused in Plan) | 9859ea6 | 2026-11-18: `src/server/browserTools.js:17-18`; `src/server/app.js:1946` plan refusal. |
| Q2-S2 | `move_to_new_chat` leaves Plan refused | 2892fa4 | 2026-11-18: `src/server/app.js:1946` (`name === 'move_to_new_chat'`). |
| Q2-S3 | Connector read-only labels are a suggestion; trust needs the person | 7efc56d | 2026-11-18: `src/server/mcp.js:176` (hint only), `mcp.js:363-367` (trust). |
| D2-1..D2-4 | D-2 panes server: realpath containment, 1 MB read cap, diff caps, .git and node_modules consistent | 9ca3f77 | 2026-11-18: ancestor of main. Security's note at e231f5b (FAIL at 9ca3f77) says D2-1 to D2-4 fixed. |
| D2-5 | Folder routes: a folder must be chosen with the native picker in the desktop app | 98ee19a | 2026-11-18: `src/server/app.js:1487-1496` (`folderPickerOnly`), `electron/main.js:51` sets it; ancestor of main. |
| B-1 | `bootstrap.mjs` spawn quote-safe: shell only for `.cmd` | 332f44a | 2026-11-18: `scripts/bootstrap.mjs:15`; ancestor of main. Tech Lead PASS at 332f44a (242ef8c). Drop of unused imports not checked. |
| D1-design | 0.1.4 screens design review, built | 2cfeec5 | 2026-11-18: ancestor of main. Sign-offs are tracked in D1 (OPEN). |
| S-1 (filed) | Duplicate of S-1 | ca01243 | see S-1 |
| S-2b | Updater: code-signing decision. Owner, typed in the Chief of Staff's chat, 2026-11-18: "We are not signing the code." The installer stays unsigned and the release notes keep the SmartScreen line. Recorded in `docs/plans/2026-11-18-v0.1.10-plan.md:61` (origin/main). Closed. | none (decision, no code) | 2026-11-18, owner's words above |

## RESOLVED ROWS REMOVED

<!-- Earlier "claimed" and "filed" rows that are now DONE above, so the open list above is the only list of work. -->
