# Security - session log

Newest entry on top. Only this session writes this file.

## 2026-11-17 - K-1 final `9538bcb`: PASS (kit 0.6.0 with our guard hardening, staged)

Both blockers closed and verified: `bootstrap role` and every other id take plain names only (35 ids across 6 commands, only the two plain ones ran, reserved names and trailing dots now refused); the project is found from `CLAUDE_PROJECT_DIR`, then the hook's own location, then the agent's cwd (5 of 6 nested-repo combinations all refused; the sixth needs no `CLAUDE_PROJECT_DIR`, a hook script outside the project and a planted policy, accepted). Checklist 24 of 24 on my machine; my five attack lists unchanged, no regression; the default fetch refspec works, the `heads/main` push spellings are refused. Not run by me: Builder A's 149 and QA's 29, 0.6.0's own suite. Conditions at landing: `AGENTS.md` line that `bootstrap upgrade` is not to be run (it would copy the plugin's plain guard over ours), land through the owner's kit-apply yes with this sign-off on the same sha, and run the checklist, guard suites and my attack lists once on the live files before the old guard is retired. Review `docs/security/2026-11-17-k1-kit-next-review-9538bcb.md`. Lesson: send the blockers with the verdict in one message and name the file and the command that reproduces each; the third round fixed exactly what was named.

## 2026-11-17 - K-1 staged kit `714a0a8` (supersedes 8c39d76): FAIL again, same two blockers

This round's changes all work (registry and persistent-environment role writes, fetch and pull refspecs as git reads them, config from the environment or the command line, guard paths in any case, a nested repository with its own policy), with no regression and 21 of 21 checklist tests. But `bootstrap.mjs` was not touched, so K1-1 (`bootstrap role ../../AGENTS` and `../../docs/a` accepted) is as before, and K1-2 (the nested-repository rule holds only if the hook's own cwd is the project folder: 6 of 6 refused then, 6 of 6 allowed otherwise, with or without a policy of its own) is as before. Review `docs/security/2026-11-17-k1-kit-next-review-714a0a8.md`. Lesson: when a fix round answers a different list than the reviewer's, say which of the reviewer's items it covers; I should have sent my two blockers in the same message as the FAIL so they could not cross with the new round.

## 2026-11-17 - K-1 staged kit `8c39d76` (`scripts/kit-next`): FAIL, two small blockers

Ran my whole attack list (section D) through the staged `guard.decide()` and the staged `bootstrap.mjs` in throwaway repositories, plus a baseline against the v0.1.7 guard; Builder A's 19-row checklist passes (19 of 19). Holds: protected files in about 50 spellings (case, dots, ADS, 8.3, device prefixes, junction), other roles' records, 50 push spellings, hook skipping, tags, labels, remotes, `gh` as a builder, about 40 shell writes, 23 role-spoof spellings, ids on `signoff`/`approve`/`require`/`piece` (35 ids × 8 commands, no stray file), our three hooks byte-identical, no push allow rule, guard paths need Security. Blockers: K1-1 `bootstrap role ../../AGENTS` and `role ../../docs/a` are accepted (A3 not closed for `role`; the role then reads a brief of its own choosing); K1-2 B7 (nested repository) holds only when the hook's own cwd is the project folder (6 of 6 refused then, 6 of 6 allowed when the hook runs in the nested folder; unknown which Claude Code does, ancestor walk fixes it either way). Accepted and written down: plugin hook beside ours, interpreter one-liners and link tricks (the guard is not a sandbox), quoted-argument wrappers for pushes (same as v0.1.7), UNC admin-share spelling in the Write tool (not reachable here). `bootstrap upgrade` would overwrite our guard with the plugin's plain one: not to be run. Review `docs/security/2026-11-17-k1-kit-next-review.md`, probes `docs/security/k1-probe/`. Lesson: when a row is called closed because "ids are checked", list every command that takes an id, including the one that sets the role.

## 2026-11-17 - K-1 (bootstrap kit 0.6.0 port): pre-review of the kit, list of weakenings

Owner's go "go on K-1" (via the Chief of Staff, plan 66b6e57). Read 0.6.0 (`guard.mjs`, `prepush.mjs`, `policy.mjs`, `bootstrap.mjs`, hooks, changelog), no run. The Chief's three regressions are right (push detection without a tokenizer, case-sensitive globs with no Windows normalisation, no id check). New by reading: `bootstrap signoff ../../.bootstrap/roles` writes a role's own brief and drops its limits (A3 is worse than a path slip); shell writes are never checked against protected files; no tag, `gh`, label or remote rules; role binding only by env or `session.json`; no pre-commit or commit-msg hook (the upgrade must keep ours, including the no-Claude-credit rule); the allow rule `Bash(git push:*)` removes the click; flow and kit "records" let a guard change skip Security's sign-off. Doc `docs/security/2026-11-17-k1-kit-0.6.0-weakenings.md` (rows A1-A3, B1-B12, attack list D). Not signable until the staged guard covers every row. Lesson: a kit upgrade is a security change to the guard even when its changelog calls it a convenience; read the diff of the guard files first.

## 2026-11-17 - release-0.1.7 build fix, tip `6b06ed9` (91b659f + Builder B's build-css change): PASS stands

Read only. `package.json` is unchanged since 91b659f (`--publish never`, publish block AnfalHaider/bunny-ai). The one new change is in `scripts/build-css.mjs`: it builds the CSS in memory, compares it with `src/ui/app.css` ignoring CR, leaves the file alone when only line endings differ, and otherwise writes it with the file's own endings. It reads two design files and writes one file in `src/ui`; no network, no process, no other path. Lesson: a pre-review of a moving branch should end with the tip's sha, so the stamp names what was read.

## 2026-11-17 - release-0.1.7 build fix (`claude/release-0.1.7-buildfix` @ 91b659f): PASS stands

Read only, no tests. Changes from bf83b01 outside `docs/`: `package.json`, `scripts/build-css.mjs`, `README.md`. `npm run dist` keeps `--publish never` (nothing uploads by itself; it is the only electron-builder call in the scripts); the new `build.publish` block is `provider: github`, `owner: AnfalHaider`, `repo: bunny-ai`, exactly the feed the app's own updater and `RELEASES_FEED` already name (the app does not use electron-updater, so the block only makes electron-builder write `latest.yml`). `build-css.mjs` now writes LF whatever the checkout's line endings, which leaves a rebuilt tree clean (what `release.mjs` checks). The README rewrite is text; its statements about permission modes, window-only settings and what leaves the machine match what I verified. Lesson: a build setting that makes a file appear (latest.yml) can look like a publish setting; the flag that decides publishing is on the command line, so check both.

## 2026-11-16 - release-0.1.7 candidate `bf83b01` (909a439 + the Q2-23 token.js fix): PASS stands

The only source change is 3 lines in `src/ui/token.js` (client side of S-1): a call whose "no token" 403 arrives after another call already refreshed the token is sent once more with the new one. No new way to get a token (the same-origin page refetch is unchanged), the retry is one resend that goes straight to `nativeFetch` (no loop; a second 403 is returned as is), and a 403 means the server refused the request before acting, so a resend repeats nothing. S-1 from outside, guard on (22 requests, `docs/security/s1-probe/zz-s1.test.js`): no token, wrong token, evil Origin, `Origin: null`, rebinding Host, cross-site fetch metadata, text/plain and form posts, preflight, Google callback with a bogus state, dot-segment and trailing-slash variants all answer 403; with the page's token 200. 27 of 27 request-guard tests pass. First run of my probe used the test helper's default (guard off) and proved nothing; `localGuard: true` turns it on. Lesson: a probe that says "all open" first needs a check that the thing under test is switched on.

## 2026-11-16 - release-0.1.7 `909a439`: post-window probes, all as signed (PASS stands)

Token-only probe: 68 of the write attempts answer 403, `autoUpdate`, `fallbackWhenBusy` and `updateUrl` included, `theme` 200; the open list is the same as at 400946b. `probe.mjs` and `probe2.mjs`: no bypass; computed-argument and alias probes: only the three known non-findings. Guard: the original probe's 45 mismatches are identical to those at 900a470 (nothing new, nothing lost); W5B cases, `gh auth --show-token` (every spelling) and tag refusal in the hook as signed. `caps.js`: the token budget is never below 100,000; `secretLike`: Bearer, Basic, `sk_live_`, Cookie and Set-Cookie caught, 12 ms on adversarial input; `procGuard`: `ERN=undefined`, no supervisor left after `stopAll`. `release.mjs --dry-run` on the candidate lists every failing check at once (not main yet, no stamp, no installer, no record), publishes nothing, refuses `--draft`; the throwaway-repo probe refuses every wrong-branch, untracked, stale or junk-stamp case. Not run: gate, e2e (the Chief's two Q2-23 request-guard e2e failures are Builder A's to explain; I will look at any fix that touches the guard). Lesson: re-using a probe file name for a different probe cost me a wrong first comparison; name probes by what they test.

## 2026-11-16 - release-0.1.7 candidate `909a439`: PASS (read-only; probes after the quiet window)

The window-only table, `secure:write`, the token-cap clamp, the secret check, incognito notes, `procGuard` (no `ELECTRON_*`), `release.mjs` with its build-stamp checks and the whole guard are byte-identical to the tips I signed; `app.js` keeps all 9 window-only checks and every marker, and what the merges removed from it was replaced by variants. W4-5c (a "Thought for Ns" row) has no security effect. Review `docs/security/2026-11-16-release-0.1.7-merge-check.md`. Not run: any test or probe (quiet window). Lesson: after a merge of several signed branches, diff the fix-bearing files against each signed tip first; an empty diff is the quickest proof nothing was dropped.

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
