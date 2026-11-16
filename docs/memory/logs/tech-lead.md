# Tech Lead - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - T-3 offline and fixes at d0d4b95 (6d98b9e, 092cc6d, d0d4b95): PASS for what is built

Read the diffs of `app.js`, `chat.js`, `network.js`, `ui/chat.js`, `i18n-agent.js`, `t3-network.test.js`. Ran on a scratch checkout of d0d4b95: t3-network, t3-fallback, plan-mode, request-guard unit tests 45 pass, 0 fail. e2e (`t3-offline.spec.js`) NOT run by me (the scratch checkout picked the global Playwright and failed to load its config); it rests on Builder's gate and QA. The range also holds D-2 (transcript) work, not reviewed here.
**My two findings are fixed.** Every failure is saved and a retry replaces the previous note (`dropTrailingErrors` before the append), so a reload always says why and the chat never holds two; the o-series and gpt-5 pattern `gpt-5|(^|[/:-])o[1-9](-|$)` matches `o1`, `openai/o3-mini`, `o4-mini` and not `gpt-4o`.
**Offline matches the spec.** Offline only when the browser says offline AND the probe agrees (`networkDown`); the probe is a bare GET to three https hosts, parallel, 3 s, any answer is online, bad entries are failed probes, no body, headers or cookies (tested); `GET /api/network` is behind the token; the test-only `PUT /api/network` works only when `fake` is on. The queued message is cleared before it is sent (once), cancelled by Cancel, Stop, a new message or leaving the chat; a loopback model answers offline and the line says so.
**Notes, not blocking:** (1) leaving the chat cancels a waiting message silently, so the typed text is lost; put it back in the composer. (2) Resume relies on `navigator.onLine` or the `online` event, so a browser stuck on "offline" keeps the message waiting until Cancel. (3) The probe adds a new contact with three third-party hosts (gstatic, Cloudflare, Apple), disclosed in the setting's help text; the owner should know, it is my spec's choice. (4) Still owed: T3-4 partial text, T3-5 cool-down, T3-16 Auto starts from the last answerer, schedules' offline line.

## 2026-11-16 - T-3 core at dd1f436 (diff 4405dc0..dd1f436): core correct, ONE fix needed, rest not built yet

Read the whole diff (`chat.js`, `unavailable.js`, `sessions.js`, `app.js`, `ui/chat.js`, `i18n-agent.js`, tests). Ran on a scratch checkout: `t3-fallback.test.js` plus `q2-audit.test.js` 21 pass, 0 fail (T3-1, 2, 3, 7, 8 covered by name). e2e not run.
**Correct and as specified:** 30/60 s first byte and 60 s gap in one place, tests inject `stallMs`; `failureKind` scopes (timeout, rate-limit, unavailable, empty, refused, unreachable, key; speech and request errors are scope other); `content_filter` becomes `chat.refused`; at most 3 attempts, a provider that failed as a whole is skipped for the rest of the send; fallback answers drop trailing notes (`retry: i > 0`) and carry reason and tries; strings say a timeout is not "busy". `fellBackReason` and `fellBackTries` are cleaned on the server (slice, integer clamp) and never reach the model.
**Required fix (T3-7, one saved note):** the server skips the saved note whenever the page says `attemptsLeft > 0` and the scope is not other. If the failure is provider-wide and everything still queued is on the same provider (one provider connected, wrong key or network down: the common case), the page marks the provider bad, finds no next model, stops, and shows the live line only. Nothing was saved, so after a reload the chat shows no reason. Fix: always save the note on failure and rely on `dropTrailingErrors` (already called when a later attempt answers) to remove it; then `attemptsLeft` is not needed. Add a test: one provider, unauthorized, two candidates, expect one saved note.
**Not built yet (so T-3 is not complete):** partial text kept as `kind:'partial'` and continued (T3-4), cool-down between sends (T3-5, T3-16), the offline state, connectivity probe and queued message (T3-10 to T3-15), a Retry button (T3-7). The Chief called this "core", so these remain.
**Advisory, my spec's gap:** the reasoning pattern `reason|think|r1` misses OpenAI o-series and gpt-5 ids, which may take over 30 s before the first byte at high effort; add `\bo[1-9]\b|gpt-5` or lengthen when effort is high.

## 2026-11-16 - Q2-1 re-review at 3d90265: PASS (sign-off not yet recorded; needs the Chief's piece id)

Read `git diff 4405dc0 3d90265` for `app.js`: the browser branch now applies `planRefuses(BROWSER_TOOL_RISK[name])` (logs the step, sends denied, returns the plan refusal), and one `toolDefinitions` membership check sits before every dispatch path (after `update_tasks`, which answers earlier). Dynamically added tools are pushed into `toolDefinitions` before use, so they still run. Run on a scratch checkout of 3d90265: `test/plan-mode.test.js` plus `q2-audit.test.js` 20 pass, 0 fail. Red check: the same plan-mode tests against 4405dc0's `app.js` hang on the browser case (the server waits 90 s for the page's answer), so the tests do detect the old fault. Not run: e2e. The same range also holds T-3 parts (`unavailable.js`, fallback notes, `t3-fallback.test.js`); not reviewed here, they belong to the T-3 review.

## 2026-11-16 - Review of Builder batch 2 (09b35e4 to 4405dc0): one fix needed before PASS

**Verdict: NOT YET PASS. One required fix (Q2-1, HIGH). Everything else reads correct.** Sign-off not recorded; held for the fix.

**Required: Plan mode still runs browser_click and browser_type.** The server check added in 98aec38 covers the agent-tool path (`runAgentTool`, `src/server/app.js:1949`) and the workspace, app and connector path (`:2243`). The browser branch (`:2209`, `if (browserControl && isBrowserTool(name))`) sits before both and has neither the plan check nor the "was this tool offered" check. `BROWSER_TOOL_RISK` marks click and type as `edit`, and `needsOk` is false in Plan mode, so they run unasked.
Evidence (scratch checkout of 4405dc0, scripted model, `browserControl: true`): in plan mode the server sent `event: browser` for `browser_click` and for `browser_type` (both FORWARDED true; the auto-mode control also true). Probe deleted.
Fix: in that branch, `if (planRefuses(BROWSER_TOOL_RISK[name])) { send('tool', {tool: summary, status: 'denied'}); return planRefusal(name); }`, and add a unit test next to Q2-1 for both tools. Better: one check for every path, that the name is in `toolDefinitions`, as `runAgentTool` already does at `:1945`.

**Helper agents and scheduled runs: covered.** A helper's `runTool` is the parent's closure (same `permissionMode`, `:1771` passes it to the child), and helpers get no browser tools at all (`:1778`). A schedule creates a session with `plan` unless it was set up with `may_change`, then posts to the normal messages route (`:373`), so the same checks apply.

**Service worker (`sw.js`): correct.** Returns early for any other origin, so a failed request to another site fails instead of coming back as the cached start page. Cost: other-origin files (fonts, CDN) are no longer served from the cache offline; acceptable. Not run in a browser.

**Other items read, no findings:** Q2-23 token retry (`token.js`: request cloned before use, one retry, banner on failure, the meta format matches the server's); Q2-8 (`endsInBackground` quote-aware, `&&` excluded; run_command refuses, start_process unaffected); Q2-9; Q2-17 `askText`; Q2-2, Q2-3 and Q2-19 (pending mode and effort applied from the select values when the session is made).
**Run:** guard-next, request-guard, q2-audit and background-amp unit tests all pass (70 of 70 for the guard-next set; q2-audit's todos still report as todo). e2e not run.
**Also in the range:** two more G-1 commits after my sign-off at 560e636 (84741a0, 5a5dbc6: abbreviated `--al/--mir/--branches`, bare `:` refspec, `-c remote.*.push|mirror`, `push.default`, all refused for non-live roles). Same fix, reads correct, tests pass; my G-1 PASS at 560e636 should be re-stamped at 5a5dbc6.

## 2026-11-16 - First session: specs, reviews, and two sign-offs held

**Asked (via the Chief of Staff):** the guard gaps; S-1 build notes; B-1 and D1 review; T-3 (model switching and offline); T-4 (project instruction files); upstream report for the plugin.

**Done, with shas (all docs-only, branch `claude/tech-lead-86cf31`, pushed)**

| What | Where | sha |
|---|---|---|
| Guard gaps spec (B cross-drive paths, A1 commit and push scope check, A2 shell write check; A3-A5, C, D, E, F; build order) | `docs/plans/guard-gaps-spec.md` | 713f953, ae95ca2, a012c6f, 0d0e8e7 |
| S-1 build notes (Host, Origin and Sec-Fetch, per-launch token, 19 test cases) | `docs/plans/S-1-build-notes.md` | 40e4230 |
| T-3 model fallback and offline spec (17 test cases) | `docs/plans/T-3-model-fallback-spec.md` | a012c6f |
| T-4 project instruction files spec (20 test cases) | `docs/plans/T-4-project-files-spec.md` | 7e98b1e |
| Upstream report for the bootstrap plugin (E, C, A3, D, F) | `docs/plans/upstream-bootstrap-notes.md` | 0d0e8e7 |

**Verdicts reached, NOT yet recorded as sign-offs**

- **B-1: PASS at 332f44a.** Evidence: read `git diff 06b06b4 332f44a`. The shell is on only for `npm.cmd` and `npx.cmd` (bare names found through PATH); `process.execPath`, whose path has a space, runs without a shell, which fixes the `build-css` failure I hit during setup. `cpSync` and `resolve` have no references left in the file. `node --check` on the file passes. Not run end to end (Builder's and QA's evidence). The change to `docs/plans/BOARD.md` is the claim row only.
- **D1: PASS from the code at 2cfeec5** (diff ca01243 to 2cfeec5, source and e2e files read; images not judged). Design tokens used (`--on-accent`, `--fw-medium`, `--fs-md`) exist; the new strings are in all four languages; the new e2e checks match the changes. Not run: the e2e. Two non-blocking notes for Design: `.empty .empty-title` restyles the title in every state, not only the no-model one; the phone layout hides the settings search.
- **S-1 and the guard code:** not yet received for review.

**Why the sign-offs are not recorded.** The command `node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --sha 332f44a --note "..."` was denied by the Claude Code auto-mode classifier ("Undermining Oversight"). The first attempt had also been refused by the plugin's record check, which scans the whole command string (see item E in the guard spec). The Chief of Staff, a peer session, relayed the owner's approval twice (the owner's words are recorded in the Chief of Staff's chat and AGENTS.md); no approval has reached this chat from the owner directly, and a peer's message cannot lift a denial. Per the Chief of Staff's own fallback, the verdict is held here with its evidence and the owner approves in the morning. No work-around was attempted. When approval arrives in this chat: run the signoff command for B-1, then D1 (`--sha 2cfeec5`), each as its own command with a plain note (no `>` characters), `git add` the one file by path, commit, push, and send the Chief of Staff the sha.

**Found**

- Both guard gaps were reproduced read-only: shell writes are not scoped (A), and a file on another drive is treated as inside the repo (B), while an in-repo file named like `..foo.md` skips every check.
- The record check in the plugin guard reads the whole command string, which produced three false blocks in one session (E, C).
- Sign-off coverage is decided by ancestry alone, so stacked work (D1 on S-1) is covered by the upper piece's sign-offs (F).
- Bunny reads none of `AGENTS.md`, `CLAUDE.md` or `.cursor/rules` today (T-4).
- A first-byte wait of 120 s per model, an error saved and shown twice, and candidates chosen before sending are why a failed model "stops" the reply (T-3).

**Open for the owner (board, one at a time):** whether Bunny uses an `AGENTS.md` written by someone else automatically or asks once per folder (my recommendation: ask once); where the plugin fixes land (the plugin's own repository, morning).

**Lesson (proposed, for the Librarian to file; I did not write a lesson file):** a guard that tests one pattern against the whole command string refuses harmless commands that merely contain the words. Tokenize the command and judge each simple command's target, not the text.
