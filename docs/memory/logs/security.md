# Security - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - W5-7 `c1b4c18` PASS (six more ordinary keys); w6 trio `1d8f6ec` PASS (help text)

Of the six keys added to the known list, five are display or convenience (`chartsEnabled`, `statusLabels`, `transcriptView`, `promptSuggestions`, `fallbackWhenBusy`; the last defaults on and only the window reads it). `autoUpdate` is read by the updater in `electron/main.js` (`!== false`): with only the page token it can be set to false, which silently stops updates (the feed address stays window-only). LOW: put `autoUpdate` on the window-only list; no other change. The w6-2, w6-18 and w4-1d re-stamp at `1d8f6ec` is one help-text line in `settings.html` (the token budget "cannot be turned off, the smallest allowed is 100,000"), which matches `caps.js`. Lesson: a setting that stops the app updating is a security setting even if the screen calls it a preference.

## 2026-11-16 - Final v0.1.7 re-stamps: W5-7 `400946b` PASS, W5-8 `349061d` PASS

W5-7: 68 of the 109 token-only attempts now answer 403; the continue keys, `maxTokens`, `helpersEnabled`, `modelFilter` and the question route are window-only; unknown settings keys answer 400; W27d-1 (computed arguments ask) closed, all W2-7 probes clean. W5-8: HEAD must be the target, untracked files count, `dist/build-sha.txt` must equal the target, only `--notes-file` goes to gh; all three of my conditions closed and verified on a throwaway repo; 18 of 18 tests. Review `docs/security/2026-11-16-w5-7-w5-8-recheck.md`. Lesson: when a fix adds a stamp, test the stamp that is missing, stale, dirty and junk, not only the one that matches.

## 2026-11-16 - W5-7 (`32a3a8c`) PASS; W5-8 (`70bd964`) PASS with conditions

W5-7: with only the page token in the desktop-app configuration, 66 write routes and 43 settings keys tried; the whole W27c-1 list, connectors, schedules, hooks, skills, plugins, custom tools, permission and capability answers, computer, terminal, providers, sign-ins and 16 settings keys answer 403. Open (low): five continue keys and `maxTokens`, `helpersEnabled`, `unrelatedTask`, `modelFilter`, unknown keys; the question route. W5-8: the release target check holds for which commit is tagged, not which commit was built: `--target origin/main` from another branch, an untracked file under `src/`, and a stale `dist/` all pass. Review `docs/security/2026-11-16-w5-7-w5-8-review.md`. Lesson: a check on the tag is not a check on the artifact; tie the two with a build stamp.

## 2026-11-16 - Verdicts for the 0.1.5 scope (Builder branch at 9ca3f77)

| Piece | Verdict | Evidence |
|---|---|---|
| S-1 request guard, re-fix `09b35e4` | **PASS** (signed, `91b7de5`) | attacks refused on an invented profile; Google callback only with a live one-time state; 92 e2e pass |
| G-1 guard rework (staged, `560e636`; later guard commits not re-read) | **PASS with conditions**, log only | `docs/security/2026-11-16-g1-guard-review.md`; open: G1-1 `gh release/pr merge/api` unguarded (HIGH), G1-2 records not checked at commit (MEDIUM), G1-3..G1-5. It is staged, not landed: today's live guard still has its false blocks and gaps |
| T-3 network probe, `092cc6d` | **PASS** | three fixed hosts, nothing of the person sent, behind the S-1 guard, no way to name a URL |
| D-2 pane endpoints, `9ca3f77` | **FAIL** (signed `e231f5b`) | D2-1..D2-4 fixed and verified; D2-5 not active in the desktop app (`electron/main.js` still `createApp({ dataDir })`, picker result not recorded); `/api/schedules` and `/api/projects` store any folder. Branch head is still `9ca3f77`, so both are open now |
| Q2-1 Plan mode | **Partly**, log only | browser click/type now refused in Plan (`app.js:2300`, verified by reading); `move_to_new_chat` is still not refused in Plan (Q2-S2 open); connector `readOnly` self-declared (Q2-S3, accepted) |
| Q2-23 token re-read | **PASS** | foreign page cannot get the token |
| Auto-mode build actions (`fde15a5`) | **Matches the owner's rule exactly** | risk note and middle way in the entry below; owner's decision |

**For the release:** the one blocker I hold is D-2 (two small fixes, then one re-run and sign). If the owner wants 0.1.5 out before that, the choice is: ship with the Files and Changes panes' folder routes disabled in the desktop app, or accept that any script flaw in Bunny's own pages could read the disk. I recommend the fix, not the exception. Nothing else I reviewed blocks 0.1.5; G-1 and Q2-S2 are board rows for after.

## 2026-11-16 - D-2 panes second re-review (9ca3f77): FAIL, two small things left

D2-1 to D2-4 fixed and verified (junction leak gone, 1 MB read, caps, .git and node_modules refused). D2-5 works on the server when folderPickerOnly is on, but the desktop app never turns it on: electron/main.js still calls createApp with only dataDir and never records the picker's result. Also /api/schedules and /api/projects still store any folder. Signed FAIL at 9ca3f77 (d-2 security sign-off); details in the review's second addendum. Expect PASS after the Electron wiring and the two routes.

**Lesson:** "passes the flag in main.js" is a claim about a file; open the file at the sha before signing.

## 2026-11-16 - Auto mode runs build actions without asking (fde15a5, seen at 78f49fe)

**(1) Does it match the owner's rule? Yes, exactly.** `needsOk` (`src/server/app.js`, the line after "Whatever the person allowed applies in full"): `send` asks in every mode; `build` asks unless the mode is Auto; Manual asks for edit and run; Accept edits asks for run; Plan refuses edit, run, build and send (`planRefuses`). Email send moved from build to its own `send` risk (`gmail_send`), so it asks in Auto and is refused in Plan. Capability switches (computer use, tool building, Code mode) still ask the person through their own question in every mode. A project file cannot set the mode (`test/permission-modes.test.js` checks the source line). Test coverage: the schedule action in all four modes, the risk table, and the source check. Not tested by behaviour: create tool, local connector, computer click and type in Auto (only the table).

**(2) Risk note for the owner.**
*What changed.* In an Auto chat, four things that used to ask now run on their own: building a new tool, a schedule that may change things, adding a local connector (a program on this computer), and clicking and typing on the computer.
*Why it matters.* Text the chat reads (a web page, a file, an email, a GitHub issue) can carry hidden instructions. Until now an Auto chat that was tricked could still do harm only while it ran. The first three of the four outlive the chat: a new tool is code that stays; a schedule created in Auto runs later with Auto rights, unattended, every few minutes, across restarts, for as long as Bunny is open; a local connector is a program that starts again with Bunny. One poisoned page could plant any of them, with no question asked, and the person is usually away in Auto. Clicking and typing are not kept, but act in whatever is signed in on screen.
*How big.* The three persistent ones are only reachable if the person has turned on tool building or the Automation feature; computer clicks only if computer control is on. Where those are off, the model must ask for the capability first and still does. In Code mode an Auto chat can already run commands in the folder, so the new exposure is persistence and reach outside the folder, not first access.
*One middle way (recommended).* Keep the owner's rule for everything except the three that outlive the chat: in Auto, a new tool, a change-making schedule and a local connector ask once, showing the exact code, schedule text or command, and then keep working; clicks, typing and every other build action run as the owner decided. That is a one-line change to `needsOk` (build asks in Auto when the call is `create_tool`, `schedule_task` with may-change, or `add_connector` with a command), plus one test per case. Nothing else in Auto changes.
*Also noted, not caused by this change:* in Auto, `calendar_create_event` (invites with attendees send mail from the person) and the GitHub write tools (`github_create_issue`, `github_comment`, `github_create_pull_request`) are `edit` risk and already ran unasked. They speak for the person like email does; the owner may want them in the `send` group.

**Owed verdicts, already given:** T-3 network probe PASS (`95588d0`, `docs/security/2026-11-16-t3-network-probe-review.md`); D-2 pane endpoints FAIL at `5f36e04` (`42e076b`, five changes sent to Builder), waiting for the new sha.

**Lesson:** when a rule moves an action from "asks" to "runs", list what the action leaves behind; the ones that persist past the chat are the ones to keep asking about.

## 2026-11-16 - D-2 panes final (5f36e04): FAIL

**Verdict: FAIL, signed** (the d-2 security sign-off file). D2-1..D2-4 from 6ef4ccf are all still present (my requests had not reached Builder). New D2-5: the folder routes' "chosen this launch" set is filled by POST /api/folder/check, which accepts any folder, so any holder of the page token can list and read any text file on the computer (tested: C:/Windows/win.ini, the .ssh listing). The S-1 guard still refuses everything without the token. Report addendum in `docs/security/2026-11-16-d2-panes-review.md`.

**Lesson:** a "chosen by the person" check is only a control if the person, not the caller, sets it; and a finding has not been handed over until the owner of the fix has it.

## 2026-11-16 - D-2 Changes and Files panes, server (6ef4ccf)

**Verdict (log only): changes first, not signed yet.** `inside()` held against every escape I tried (dotdot, absolute, drive, UNC, device, junction, NUL, reserved names). Found: the Changes route leaks through a link (changesFor checks the path by text only; probe read OUTSIDE-SECRET), a 300 MB file is read whole then cut (+301 MB memory), diffs can freeze the server, listing and reading disagree about .git. Report `docs/security/2026-11-16-d2-panes-review.md`; board D2-1..D2-4; probe in `docs/security/d2-probe/`. File symlinks not tested (no privilege to make one).

**Lesson:** a containment gate only protects the routes that use it; check every function that takes a path, not just the one named in the brief.

## 2026-11-16 - T-3 offline network probe (092cc6d)

**Verdict (log only): PASS.** Three fixed https hosts (Google, Cloudflare, Apple), bare GET, no cookies or custom headers, redirects not followed, nothing of the person sent; asked only when the browser already says offline. Behind the S-1 guard (403 without token, cross-site or foreign origin, checked live on an invented profile). No request input reaches the host list, so no arbitrary fetch. Notes: cancel the unread response body; name the hosts in the help text. Report `docs/security/2026-11-16-t3-network-probe-review.md`. The probe was not called live.

**Lesson:** for a "check connectivity" feature, the review is what leaves the machine and who can trigger it; both are answered by reading one constant and one route.

## 2026-11-16 - Q2-1 Plan mode and Q2-23 token re-read (4405dc0)

**Verdict (log only):** Q2-23 PASS. Q2-1 FAIL as a read-only guarantee, two bypasses: browser_click and browser_type run in Plan mode (the browser branch of runTool, app.js:2208, has no planRefuses), and move_to_new_chat opens and sends a new chat outside Plan mode. Helpers, scheduled tasks, custom tools and connector tools are covered. Report `docs/security/2026-11-16-q2-1-and-q2-23-review.md`; board row Q2-S1..S3. Read from the code, not exploited.

**Lesson:** a refusal added at two dispatch points misses the third; list every way a tool call can enter the runner before saying "on the server".

## 2026-11-16 - G-1 guard rework review (560e636)

**Asked:** look for any way a role escapes its write scope, pushes main, skips hooks or forges a record, and for false blocks.

**Verdict: PASS with conditions** (log only; the sign-off waits for the final release sha). Report `docs/security/2026-11-16-g1-guard-review.md`; probes in `docs/security/g1-probe/`.

**Evidence:** their 70 guard tests pass; my probe 1: 124 cases, 104 as expected; no false blocks on 26 normal commands; the four false blocks the live guard gave me this session are allowed by the staged one. Gaps: G1-1 HIGH `gh release/pr merge/api` unguarded; G1-2 MEDIUM records not authenticated at commit (forged QA sign-off passes pre-commit); G1-3 MEDIUM hooks folder removable, alias/--git-dir skips; G1-4 dynamic push refspec; G1-5 role by variable. Board rows G1-1..G1-5 filed.

**Lesson:** a guard that lists protected files must also protect the folder that holds them, and the record that says "reviewed" must be checked where git checks it, not only where the tool can see it.

## 2026-11-16 - Baseline review of 0.1.4

**Asked:** baseline review of the update channel, secret storage, the 0.1.4 surfaces and the npm audit findings; findings with file:line, severity and a recommendation; fix nothing.

**Did:** read-only review of `electron/updater.js`, `src/providers/secretStore.js`, the profile photo / memory import / import / search / move_to_new_chat code and `npm audit`. Report: `docs/security/2026-11-16-baseline-0.1.4.md` (S-1..S-10). Board rows S-1..S-8 filed. Not covered: agent command/file tools, MCP and browser control, sign-in flows, artifact serving, UI output rendering.

**Evidence:** `npm audit`: 6 moderate, 0 high (dev-only, electron-builder to minimatch). Other findings are code reading, not run exploits.

**Lesson:** the local API has no caller check; a random port is not an access control.
