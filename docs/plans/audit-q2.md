# Q-2 audit: every control, on an invented profile

QA session, 2026-11-16. Build under test: 0.1.4 at `4a399f0` (app code identical to `06b06b4`; `initial-import` `5cc3801` differs only in tooling and docs).
Task from the owner (relayed by the Chief of Staff): "go through all the navigation items, all settings, then make detailed tests to evaluate that everything is working without bugs and efficiently. dont assume anything."
Docs and tests only. Nothing in `src/` was changed. Nothing here touched `%LOCALAPPDATA%\BunnyAI`.

## How it was run

- Profile: a new temp folder per run (`BUNNY_DATA_DIR`), `BUNNY_FAKE_UPSTREAM=1`, `node src/server/main.js` on a free port. Every script refuses to run unless `/api/health` says `fake: true`.
- A scripted OpenAI-compatible model (added as a custom provider, the way a person adds one) stood in wherever a real reply shape was needed: tool calls, slow replies, 429s, replies that never come.
- Folders for Code mode were new temp folders (one was a git repo, one a plain folder, one a dev-server project).
- Browser: Chromium through Playwright at 1400x900. **Not run in the installed Electron app** (the electron binary is not installed in this worktree, and starting it risks the owner's running instance). Anything that only exists in Electron is marked UNKNOWN.
- Scripts (all in `e2e/`, none is picked up by the gate): `q2-inventory.mjs` (every control from the live DOM), `q2-controls.mjs` (chat shell, 43 checks), `q2-panes.mjs` (panes and Code mode, 17), `q2-pages.mjs` (Settings sections, Providers, Automation, Customize, 19), `q2-code-mode.mjs` and `q2-fallback.mjs` (the owner's screenshots), `q2-perf.mjs` (timings), `q2-make-inventory.mjs` (builds the inventory table), `q2-probe.mjs` (scratch probes used while finding causes).
- Screenshots are in `%TEMP%\qa-q2\final\` on this machine and are **not committed**: some show the Windows user name in the greeting.
- The 0.1.4 screens (Profile, Appearance, My Dear Bunny, Code settings, zoom, greeting, hopping bunny) were walked earlier: `docs/qa/2026-11-16-0.1.4-walk.md`, 57 of 57 PASS. They are not repeated here.

## Result

| | Count |
|---|---|
| Controls inventoried (live DOM, 5 pages) | 316 (`docs/plans/audit-q2-inventory.md`, one row each) |
| Verdicts in the inventory | 245 PASS, 23 FAIL, 48 UNKNOWN |
| Checks driven in this audit | 79 (`controls` 43, `panes` 17, `pages` 19) plus the six fallback and Code-mode reproductions |
| Defects | 30 raised (5 High, 15 Medium, 10 Low), 1 decision for the owner and 1 open question; 8 are fixed and re-walked on `4405dc0` (see below) |
| New tests | 23 unit (6 pass, 17 todo = defects), 17 browser (7 pass, 10 expected-fail = defects); the gate passes 6/6 with them |

The owner's reports are all real. Four of the six panes the owner mentioned are partly or wholly empty shells, and the model fallback is slower and messier than the screen suggests.

## The owner's screenshots, reproduced

| # | Owner's report | Reproduced? | What is going on | Defect |
|---|---|---|---|---|
| a | `npx serve -l 3001 &` in Code mode: "The ampersand (&) character is not allowed" | Yes, word for word (`q2-code-mode.mjs`) | `run_command` runs Windows PowerShell 5.1. The code rewrites `&&` and `\|\|` but not a trailing `&`. The tool text does not mention `&`, nothing steers the model to `start_process`. | Q2-8 |
| b | The browser opened localhost:3001 before the server was up (chrome-error page) | Yes (on port 4999: this machine has another site answering on 3001) | The pane sets the frame's address and never checks the page came up; the frame's URL is `chrome-error://chromewebdata/` and the pane says nothing. The "Run and open" card waits a fixed 4 seconds. | Q2-9 |
| c | "…could not finish: The provider did not answer in time" shown twice, no clean fallback | Yes, with timings (below) | 120 s of silence per attempt, up to three attempts in a row; a red line for every failed attempt stays in the chat even when a later model answers; the note on the answer says "busy" when the model was not busy. | Q2-10 to Q2-13 |
| d | Changes: "No changes yet" after files changed in a non-git folder | Yes, also in a git repo | The pane is markup only: nothing fills it and nothing serves a list of changed files. The data exists (the Undo bar's checkpoints hold every changed path). | Q2-4 |
| e | Files pane not wired | Yes | Same: markup only. | Q2-5 |
| f | Session pane thin | Yes | Five lines: This computer, project, context %, connectors, outputs. | Q2-6 |

### (c) in numbers: a model that never answers (`e2e/q2-fallback.mjs`, scripted provider, 4 runs in parallel)

| Run | What happened | Time to the first word from a model that answered |
|---|---|---|
| Picked model stalls, fallback on | `offline/bunny-code` silent 120 s, then `bunny-large` answers. Transcript keeps one red line "…bunny-code could not finish: The provider did not answer in time" and the note says "Answered by bunny-large because bunny-code was busy". | 122 s |
| Auto, top two stall | Two silent attempts, then the third model answers. **Two** red lines stay in the chat; the note names only the last one: "(Bunny Large did not answer)". | 242 s |
| Auto, every model stalls | Three silent attempts (120 s each). Result: **three identical red lines**, no summary, no "try again", no hint which provider. | 363 s, then nothing |
| Picked model answers 429 | Switches at once (2 s), one red line stays, note says "busy" (correct here). | 4 s |
| Picked and fallbacks all unreachable (fast error) | Three requests, three red lines, same wording. | 2 s |

During the wait the only thing on screen is "Streaming…" and the hopping bunny.

## Defects

Severity: **High** = wrong or unsafe result, or a control that does nothing; **Medium** = works but misleads, loses information, or is slow; **Low** = rough edge. "Test" is the regression test that pins it (`todo` / expected-fail until fixed; remove the marker when it passes).

| Id | Sev | Defect | Cause (file:line) | Evidence | Test |
|---|---|---|---|---|---|
| Q2-1 | High | **Plan mode does not stop a write.** The model is only *offered* read tools in Plan mode; if it calls `write_file` / `run_command` anyway (a hallucinated call, or text in a file it read telling it to) the server runs it with no prompt. | `src/server/app.js:2227-2248` (`risk` at `:2227`, `needsOk` at `:2233` knows only Manual and Accept edits, then `workspace.run` at `:2248`); `:1509-1512`. The agent-tool path has the missing check at `:1931`, the workspace path does not. | `q2-panes.mjs` CM7: session `permissionMode=plan`, `write_file` called, `note.txt` created, no prompt. | `test/q2-audit.test.js` Q2-1 (todo) |
| Q2-2 | High | **A permission mode chosen in a new chat silently reverts.** Pick Plan, then touch the folder or branch chip: the mode goes back to the default (Manual). If the default were Auto, a person who chose Plan would get Auto. | `src/ui/chat.js:259` `renderComposerHeader` sets the select to `session?.permissionMode ?? default` and there is no session yet; `useFolder` and the branch chip call it. | probe `modeclobber`: "after choosing Plan, label: Plan"; "after clicking the branch chip, label: Manual". | `e2e/q2-audit.spec.js` Q2-2; unit Q2-2 |
| Q2-3 | Medium | Choosing a permission mode or effort before the first message sends `PATCH /api/sessions/null/setting/…` (404) and logs an unhandled error each time. The value is not lost, but the console fills and a real failure would be hidden. | `src/ui/chat.js:3297-3304` (`sessionSetting(state.sessionId, …)` with no session; same in the effort handler at `:3302`). | `q2-code-mode.mjs`, `q2-panes.mjs` CM1, CM6-CM8: "404 PATCH /api/sessions/null/setting/permissionMode"; `pageerror: Error: HTTP 404`. | e2e Q2-3; unit Q2-3 |
| Q2-4 | High | **Changes pane is not wired** (owner (d)). "No changes yet" always; Refresh does nothing. | `src/ui/index.html:312-315` markup only; no code in `src/ui/*.js` uses `#diff-content` or `#pane-diff-refresh`; no server route lists changes. `src/server/checkpoints.js` already stores each changed path and its before-image, with no read route. | `q2-panes.mjs` CM2 (git repo, README.md modified on disk, pane empty); `q2-code-mode.mjs` (plain folder, Undo bar says "Files changed: 2", pane empty). | e2e Q2-4, Q2-4b; unit Q2-4 |
| Q2-5 | High | **Files pane is not wired** (owner (e)). Says "Open a file to read it" and nothing can open one. | `src/ui/index.html:354-356`; no code uses `#file-content`; no server route lists or reads a folder for the UI (only the model's tools can). | `q2-panes.mjs` CM3. | e2e Q2-5; unit Q2-5 |
| Q2-6 | Medium | **Session pane is thin** (owner (f)): environment (always "This computer"), project, context %, connectors, outputs. Missing: folder and branch, model, permission mode and effort, message and token counts, changed files, tasks, running programs, when it started. | `src/ui/chat.js:1267-1320` (`renderRail`), `src/ui/index.html:261-285`. | `q2-panes.mjs` CM4: pane text is `Session ✕ Environment This computer No project Context 0% Connectors No connectors yet. Outputs Nothing saved yet.` | e2e Q2-6; unit Q2-6 |
| Q2-7 | Low | The **Plan pane is dead**: it can say only "No plan yet.", nothing fills it, its tab is not visible, the toolbar has no button for it (the Tasks pane shows the plan). | `src/ui/index.html:295`, `:362-364`. | `q2-code-mode.mjs`: "Plan tab visible to a person: false … Plan pane text: No plan yet." | unit Q2-7 |
| Q2-8 | Medium | **A trailing `&` fails** in `run_command` with `AmpersandNotAllowed` (owner (a)); the model is not told how to start a background program from there. | `src/server/workspace.js:66-90` (`translateChains`: only `&&` and `\|\|`); tool text in `workspaceToolDefinitions` ("separate commands with ;"); system prompt `src/server/app.js:1527` mentions `start_process` but nothing enforces it. | `q2-code-mode.mjs`: `Run npx serve -l 3001 &` → `[exit code 1] … The ampersand (&) character is not allowed`. | unit Q2-8 |
| Q2-9 | Medium | **Browser pane shows a browser error page for an unreachable URL** and says nothing; the model's `browser_open` still reports success; "Run and open" opens after a fixed 4 s whether or not the server is up. | `src/ui/browser-pane.js:81-84` (`show` sets `src`), `:131-139` (`checkBlocked` only handles `about:blank`), `:158` (`setTimeout(…, 4000)`), `:229-236` (`act('open')` returns the success note). | `q2-panes.mjs` PN4: frame `chrome-error://chromewebdata/`, pane text "". PN5: card opened after 6.1 s. | e2e Q2-9; unit Q2-9 |
| Q2-10 | High | **A model that does not answer holds the chat for 120 s per attempt, three attempts in a row** (owner (c)): 2, 4 and 6 minutes with only "Streaming…". The first-byte wait uses the same 120 s as mid-stream silence. | `src/server/chat.js:20` `DEFAULT_STALL_MS = 120_000`; `:200` first-byte timer; fallback loop `src/ui/chat.js:2007-2037` (one candidate at a time: picked plus two at `:2001`, or Auto's top four at `:1994`). | Fallback table above: 122 s, 242 s, 363 s. | unit Q2-10 |
| Q2-11 | Medium | **Failed attempts stay in the chat as red lines** even when a later model answered. In Auto with two stalls: two lines (what the owner saw "twice"). | `src/server/app.js:2419` appends an error message for every failed attempt; nothing removes it when the retry (`retry: true`) succeeds. | Fallback table: "Two red lines stay", saved messages `assistant/error, assistant/error, assistant/text`. | unit Q2-11 (route level, 429) |
| Q2-12 | Medium | **The note on the answer is wrong or incomplete.** One string for every failure, "Answered by X because Y was busy", even when Y did not answer; in Auto it names only the last model that failed and drops the first. | `src/ui/i18n-agent.js:15`; the label code `src/ui/chat.js:1042`; `fellBackFrom` carries one name (`:2023`). | Fallback table, runs 1 and 2. | unit Q2-12 |
| Q2-13 | Medium | **When every model fails the person gets three identical red lines and nothing else**: no "all of them failed", no which-provider, no Retry-with-a-different-provider offer; the candidate list can be all one provider (no check). | `src/ui/chat.js:1994-2001` (candidate choice), `:2030-2037` (the loop ends on the last candidate with no summary). | Fallback table, "every model stalls" and "unreachable" rows. | (documented; needs the Builder's design first) |
| Q2-14 | Low | **The command palette cannot be driven from the keyboard.** Arrow keys and Enter do nothing; no item is highlighted. | `src/ui/chat.js:3198` (only an `input` listener on `#palette-input`). | `q2-controls.mjs` K1b. | e2e Q2-14; unit Q2-14 |
| Q2-15 | Low | The palette's **Settings and Providers commands leave the chat** (full page load of `settings.html` / `providers.html`) instead of opening the Settings window as the gear, the account menu and Ctrl+, do. | `src/ui/chat.js:2959-2960`. | K1c: URL becomes `/src/ui/settings.html`. | e2e Q2-15; unit Q2-15 |
| Q2-16 | Low | A pasted transcript written as `User: …` / `Assistant: …` on one line is rejected ("No messages were found in that file."). Headings (`## You`) work. | `src/server/import.js:98` (a label only matches when it stands alone on its line). | `q2-controls.mjs` N13b. | unit Q2-16 |
| Q2-17 | Medium (not verified in Electron) | **Rename chat uses `window.prompt`**, which Electron does not support (it throws). Likely broken in the installed app; works in a browser. | `src/ui/chat.js:766`. | Works in Chromium (N8). Electron not run here. | unit Q2-17 |
| Q2-18 | Low | **＋ New terminal does nothing** once a shell exists; the shell shows no prompt or greeting on open. | `src/ui/chat.js:168` (`terminalStart` returns at once if `state.terminalId` is set). | `q2-panes.mjs` PN1b: "tabs 1 -> 1"; PN1 "first output: ''". | unit Q2-18 |
| Q2-19 | Medium | **After Stop, the stopped reply vanishes from the screen** in any chat that already has a reply (reopened, imported, after a reload). It is saved; it comes back after a reload. In a brand-new chat it works. | `src/ui/chat.js:1864-1865` `refreshSession` stops polling as soon as *any* assistant message exists, so it reads the transcript before the server has saved the stopped one. | `q2-controls.mjs` C7 (fails after the import row; passes alone); probe `stopreopen`: fresh chat "1111111111", same chat after reload "0000000000". | e2e Q2-19 |
| Q2-20 | Low | Seven switches have no accessible name (a screen reader says "on, checkbox"): the eight Capabilities switches, Notifications, "Also let Bunny use Gmail…", the About row. | `src/ui/settings.html:187`, `:252-320` (no `aria-label`). | `q2-inventory.mjs` rows with an empty name. | (accessibility; no test yet) |
| Q2-21 | Low | The dev-server card says "running" if **anything** answers on the guessed port, even another project's site (on this machine port 3001 serves an unrelated site). | `src/server/workspace.js:373-377` (`running = res.status > 0`). | `q2-code-mode.mjs` screenshot: pane on `localhost:3001` showed a different site. | (needs a port in use; see note) |
| Q2-22 | Low | `/?s=<id>` loses the chat id (the root redirects to `/src/ui/index.html` without the query); `GET /api/sessions` reads every chat: 5 ms empty, 97 ms at 155 chats, 182 ms at 317. | the root redirect at `src/server/app.js:2474-2475`; `sessions.list`. | `q2-perf.mjs`. | (observation) |
| Q2-23 | Medium | **S-1 (Builder branch, `09b35e4`): a browser tab left open across a restart of Bunny fails silently.** The tab holds the old launch token; the next send clears the box and shows nothing: no message, no error, no "out of date" notice, until the page is reloaded. The server's words ("This window is out of date. Close it and open Bunny AI again (or reload the page).") never reach the screen. Does not affect the desktop app (the window is recreated with each launch); affects `npm start` and the plain-browser preview. | the UI has no handler for the 403 `request.noToken` answer (`src/ui/token.js`, `src/ui/api.js` `sendJSON`/`getJSON`); found on the Builder branch, not in this branch's tree | `e2e/q2-s1-walk.mjs` restart probe: after the restart `#error`, `#status` and the transcript are all empty; screenshot `%TEMP%\qa-q2\s1\stale-window.png`. | unit Q2-23 (todo) |
| Q2-24 | Medium | **Computer use stays a question after it is allowed.** With the "Control this computer" grant on and the mode set to Auto (or Accept edits), every click, key press, typing and scroll still raises a permission card. The owner's rule ("when allowed by me, everything should be allowed") says it should not. | `src/server/agentTools.js:20` gives `computer_click`, `computer_type`, `computer_key` and `computer_scroll` the risk `build`; `src/server/app.js:1510` (`needsOk`) asks for `build` in every mode. | `test/q2-permissions.test.js`: Auto, grant on, click: one card. (Only ever answered Deny: nothing drove this machine.) | unit Q2-24, Q2-24b (todo) |
| Q2-25 | Low | In Manual mode every Allow covers one call only; there is no "allow for this chat" or "allow this kind of step" on the card, so a ten-file job is ten cards. (Switching to Accept edits or Auto is the way out, but the card does not say so.) | `src/ui/chat.js:1017-1030` (the card has only Allow and Deny); `src/server/app.js:1636-1644`. | `test/q2-permissions.test.js` Manual rows: one card per call. | (design; no test) |
| Q2-27 | Low | **A false "Bunny AI restarted, so this window is out of date" banner** appears when the in-app browser is pointed at one of Bunny's own `/api/...` addresses. The new reachability probe sends the page's request with `mode: 'no-cors'`, the browser drops the token header, the server answers 403 `request.noToken`, the token refresh finds the same token, and the banner is shown anyway. Rare (only Bunny's own API in its own browser pane), but the banner has no dismiss and tells the person to reload for nothing. | `src/ui/browser-pane.js` `reachable()` (found on the Builder branch at `4405dc0`) with `src/ui/token.js` `window.fetch` (`say()` after a refresh that changed nothing) | probe: browser pane to `http://127.0.0.1:PORT/api/settings`: two 403s without a token, then `#bunny-restarted` is present and covers the toolbar (`e2e/q2-s1-walk.mjs` B8). | (found on the Builder branch; no test here yet) |
| Q2-28 | Medium | **D1 fix 2 (phone Settings pill row) shows one pill at a time.** On a 390 px phone each section pill is as wide as the whole strip (364 px), so only the selected section ("Appearance") is visible and the other 14 sections can only be found by swiping sideways blind. Design's own built screenshot (`docs/design/review-0.1.4/built/settings-light-m.png`) shows the same. | `.nav-row { width: 100% }` at `src/ui/app.css:259` is not overridden by the phone rule `.settings-nav-list .nav-row { flex: none; … }` (D1, `2cfeec5`). Needs `width: auto`. | `e2e/q2-d1-walk.mjs` S-phone-light and S-phone-dark: 15 pills at `Profile -723..-359, Usage -355..9, Appearance 13..377, My Dear Bunny 381..745 …`; 1 fully visible. | `e2e/q2-d1-walk.mjs` (script, not in the gate) |
| Q2-29 | Medium | **A command that ends with an error code is shown as done, not Failed** (D-2). `exit 3` is a green "Ran a command" with no red marker; only a tool that itself errors (a file that is not there) gets the red Failed label and the error. | `src/server/workspace.js` `run_command` returns `[exit code N]` as text; `src/server/app.js` logs the step with status `done` (found on the Builder branch at `6ef4ccf`). | `e2e/q2-t3d2-walk.mjs` D2 in all four widths and themes: "no red Failed marker visible"; screenshot `d2-desktop-light-failed.png` shows `Ran a command` and the reply "That command failed." | unit Q2-29 (todo) |
| Q2-30 | Medium | **Offline with a local provider that is connected but not running (an Ollama that is closed): the message is sent anyway and fails in red.** Bunny prefers a local model when offline; when that one is down it does not fall back to the calm waiting state. | the T-3 offline path in `src/ui/chat.js` (local model preferred offline, `092cc6d`) | `e2e/q2-t3d2-walk.mjs` T4b: queued bubble 0, red failure lines 1, one request sent while offline. | (script; needs the offline switch) |
| Q2-31 | Medium | **After Stop in a Code chat that ran steps, the Stopped report and the partial reply do not appear until the page is reloaded** (they are saved). Same family as Q2-19, one case left: the steps are saved before the partial, and the wait ends at the first step. | `src/ui/chat.js:2056-2073` `refreshSession`: `assistants()` counts every assistant-role message, tool steps included (found on the Builder branch at `6ef4ccf`). | `e2e/q2-t3d2-walk.mjs` D3, four combinations: "no stopped report on screen within 6 s after Stop (saved kinds: text,tool_call,partial); after a reload it is there". | unit Q2-31 (todo) |

### Permission modes and grants (owner's rule: "when allowed by me, everything should be allowed")

`test/q2-permissions.test.js` drives a reply in each mode that calls one tool, answers every card, and records whether a card was raised and whether the tool ran. Nothing that drives this computer or builds a program was ever allowed to run (those were only answered Deny).

| Tool kind | Manual | Accept edits | Plan | Auto | Verdict |
|---|---|---|---|---|---|
| Read (`list_files`) | no card | no card | no card | no card | PASS |
| Edit (`write_file`) | card; Allow writes, Deny keeps it out and tells the model | no card, writes | **writes with no card (Q2-1)** | no card, writes | Plan FAIL, rest PASS |
| Command (`run_command`) | card | card | **runs with no card (Q2-1)** | no card, runs | Plan FAIL, rest PASS |
| Computer (`computer_click`, `_type`, `_key`, `_scroll`) | card | **card again (Q2-24)** | not offered | **card again (Q2-24)** | FAIL |
| Build (`create_tool`, a schedule that may change things, a local connector command) | card | card | not offered | card (by design) | see Q2-26 |

Grants: Code mode (the card, or the Chat/Code toggle with a folder) is remembered on the chat; Computer use and Custom tools are saved in Settings, so they are asked once. Saying no is remembered for the reply ("do not ask again"). The Capabilities switches in Settings do the same without a card.

- **Q2-26 (decision for the owner, not counted as a defect):** the code deliberately asks for "build" actions in **every** mode, Auto included: building a tool, a schedule that may change things, and adding a local connector (a program run on this computer). Under the owner's rule these would stop asking once the person has allowed it. The risk is that a script or a program is then created and run without being read. Needs the owner's word before the Builder touches it (HIGH under AGENTS.md: permissions).

### Re-walk of the Builder's fixes at `4405dc0` (QA, 2026-11-16, invented profile, guard on)

Gate on `4405dc0`: 7 of 7 (111 e2e). Scripts re-run against it with the launch token (`e2e/q2-token-preload.mjs`): `q2-controls` (43 checks), `q2-panes` (17), `q2-pages` (19), `q2-s1-walk` (33), `q2-code-mode`, `test/q2-permissions.test.js`.

| Defect | Result at `4405dc0` | Evidence |
|---|---|---|
| Q2-1 Plan mode writes | **FIXED** | Plan: write and command refused, no file, no card (CM7 PASS; both Plan rows of `q2-permissions` now pass) |
| Q2-2 mode reverts | **FIXED** | Auto stays Auto after the branch chip (CM1 PASS with the corrected expectation) |
| Q2-3 `PATCH /sessions/null` | **FIXED** | CM6 to CM8 and the Code-mode run: no 404, no page error |
| Q2-8 trailing `&` | **FIXED** | the step fails with "run_command waits for the command to finish ... Use start_process ..." |
| Q2-9 unreachable page | **FIXED** (the panel says so; the browser's own page is still in the frame behind the note) | PN4: "Could not reach http://localhost:4999. Nothing is answering there ..."; Run and open opens after 2 to 3.5 s |
| Q2-17 `window.prompt` | **FIXED** | Rename opens an in-app dialog (N8, no native prompt) |
| Q2-19 Stop in a chat with replies | **FIXED** | C7: the partial stays on screen and is saved |
| Q2-23 stale token | **FIXED** | restart probe: the send after a restart goes through, no banner |
| Q2-4, 5, 6, 7, 10 to 16, 18, 20 to 22, 24, 25 | still open (Builder: next) | controls, panes and permission scripts |

New on the Builder branch: **Q2-27** (false restart banner) and **Q2-28** (D1 phone pills). The service-worker change (other sites left alone) was exercised by PN2, PN4, PN5 and B7; no regression found.

### T-3 and D-2 on the Builder branch at `6ef4ccf` (QA, 2026-11-16)

Gate on `6ef4ccf`: 7 of 7 (123 e2e). Invented profile, guard on.

**Q2-10 to Q2-13, a model that never answers** (`e2e/q2-fallback.mjs`, same scenarios as the first audit):

| Run | Before (`19163fa`) | Now (`6ef4ccf`) | What the person sees now |
|---|---|---|---|
| Picked model stalls | 122 s, one red line left, "...was busy" | **33 s** | one line: "Answered by offline/bunny-large because offline/bunny-code did not answer in time"; no red line; the saved chat has only the answer |
| Auto, two models stall | 242 s, two red lines, note named the last | **63 s** | "Auto · Chat → offline/bunny-small (Bunny Code (offline) did not answer)": no red line; the note names only the first model that failed, not the second |
| Every model stalls | 363 s, three identical red lines | **93 s**, three attempts then stop | one collapsed line "The reply failed / Failed"; the saved chat holds one error note with the reason (it opens to it) |
| Picked model answers 429 | switched at 3 s, one red line left | 3 s | "...because offline/bunny-code was busy (rate limit or overloaded)"; no red line |
| All providers unreachable | three red lines | 1 to 5 s | one note "The reply failed", opens to the reason, with Try again and Choose another model; **one note after a reload** |

Still true: for the 30 s of each attempt the screen says only "Streaming..." (no "trying the next model" line was seen on the status line), and Auto names only the first failed model.

**T-3 offline** (`q2-t3d2-walk.mjs`: the server test switch plus the browser's offline event, and once the browser's real offline emulation): the message waits with a calm line ("You are offline. I will send this when the network is back."), a waiting bubble and an Offline chip, with no red line and no request; Cancel removes it; typing a new message replaces the waiting one; on reconnect exactly one request is sent and answered, with one user bubble; a local model (127.0.0.1) answers while offline; real offline emulation behaves the same and recovers. **One defect: Q2-30.**

**D-2 transcript** (four widths and themes): a reply with several tool runs and narrations shows narration lines between collapsed groups ("Listed a folder", "Read a file, wrote a file", "Ran a command"), sub-rows on demand, no horizontal overflow, and the same groups, notes and summaries after a reload; a failing tool (a missing file) shows the red Failed label, the file and the error; 26 chats saved by an older build (46 tool groups or rows) all open and render. **Two defects: Q2-29, Q2-31.**

### The panes at `5f36e04` (QA, 2026-11-16): Q2-4, Q2-5, Q2-6, Q2-7

Gate on `5f36e04`: 7 of 7 (128 e2e). `e2e/q2-panes2-walk.mjs`, invented profile, a git folder and a plain folder, 1440 and 390, both themes (49 checks, all 16 failures traced to Q2-7 or my own phone navigation, rerun clean below).

| Defect | Result | Evidence |
|---|---|---|
| Q2-4 Changes | **FIXED** in git and non-git folders, all four widths and themes | a new file and an edited file show as checkpoint cards ("Checkpoint 2 / Checkpoint 1") with `new` / `edited` badges and counts (`src/greet.js +1 −0`, `note.txt +3 −0`, header "2 files +4 −0"), the diff opens with added lines, "Undo to here" puts the folder back (note.txt gone from disk); empty chat says "No changes yet." |
| Q2-5 Files | **FIXED** | tree lists the folder (before any message too), a file opens read-only with line numbers (no editable field), a file Bunny changed is tinted and its lines marked, `new` marker on a created file; on a phone a file replaces the tree and has a way back |
| Q2-6 Session | **FIXED** | Where (environment, project, folder, branch `main` or "Not a git folder"), Model (model, permissions, effort), Context and cost (context %, "107 of 200,000" tokens, messages, "not reported" cost), running programs with a Stop button (the started `node` process shows), connectors, outputs; with Auto on, it names Auto's pick and why |
| Q2-7 Plan | **PARTLY**: the Plan pane is now filled (same list as Tasks) but nothing can open it: only the active pane's tab is shown and no control selects Plan | `#plan-content` holds Look / Write / Check; `#tab-plan` is never visible; Tasks already shows the same plan |

**Path escapes** (`/api/sessions/:id/files` and `/file`, 17 attempts each: `../`, `..`, `..%2F`, `%2e%2e%2f`, `src/../../secret.txt`, backslash forms, `C:\Windows\win.ini`, `C:/Windows/win.ini`, a UNC `\localhost\c$\...`, `/etc/passwd`, `README.md%00.txt`, and a Windows junction inside the folder that points outside): none returned anything outside the folder, none answered 200. `/api/folder/files` and `/file` refuse (403) every folder not chosen in this launch (`C:\Windows`, `C:\`, an outside folder, even the project before it is chosen), and after `folder/check` they still refuse `../`, the junction and a drive path. A chat that does not exist or has no folder answers without a server error. A 2 MB file comes back cut off (`truncated: true`); a binary file is flagged `binary: true`, not dumped. (The Tech Lead's `changesFor` finding was not exercised by a link that escapes: a write through the junction was not attempted.)

### Builder batch at `d2dbf82` (includes `fde15a5` and `78f49fe`) (QA, 2026-11-16)

Gate on `d2dbf82`: 7 of 7 (130 e2e). Invented profile, guard on, scripts re-run:

| Item | Result | Evidence |
|---|---|---|
| Q2-28 D1 phone Settings pills | **FIXED** | `q2-d1-walk.mjs` 24 of 24 (pills size to their text, the strip scrolls, several fully visible) |
| Q2-27 false "restarted" banner | **FIXED** | `q2-s1-walk.mjs` 33 of 33, including the terminal after the browser pane opened Bunny's own API address (the banner no longer covers the toolbar) |
| Q2-24, Q2-26 permissions | **FIXED** as decided | Auto: creating a tool runs with no card; Manual and Accept edits ask for it; computer-use clicks ask in Manual and Accept edits (answered Deny; the Auto click is not driven, it would click this screen); Builder's `test/permission-modes.test.js` and mine both pass (24 tests, 4 `todo` of which Q2-26 now passes) |
| T-3 gap 1: nothing on screen for 30 s | **FIXED** | at 32 s the status line says "offline/bunny-code is slow. Trying Bunny Large (offline)..." |
| T-3 gap 2: Auto names only the first failure | **FIXED** | "Auto · Chat → offline/bunny-small (Bunny Code (offline) did not answer in time (1 other model also failed))" |
| Waiting text kept as a draft | **FIXED** | offline, send, leave to New chat: the bubble is gone, the text is back in the box, nothing sent |
| "Checking your connection..." on reconnect | **FIXED** | the status shows it, then "Streaming...", and exactly one request ("queued again") |
| Link (junction) escape through Changes, Files, file and a model write | **no escape** | new `test/q2-escape.test.js`: the model's `write_file link/secret.txt` does not touch the outside file; none of `changes`, `files`, `file`, `files?path=link` shows outside text |
| Q2-7 Plan pane | still open | filled, but no tab opens it (8 of 8 combinations) |
| Q2-29 exit code not Failed, Q2-30 closed local provider offline, Q2-31 Stop report after steps | still open | `q2-t3d2-walk.mjs` D2, T4b, D3 unchanged; D2b (a failing tool) and the 26 older chats pass |

### Builder fixes at `9ca3f77` (QA, 2026-11-16)

Gate on `9ca3f77`: 7 of 7 (134 e2e). Scripts re-run on fresh invented profiles with the guard on:

| Item | Result | Evidence |
|---|---|---|
| Q2-29 a failing command is Failed | **FIXED** | `q2-t3d2-walk.mjs` D2 passes in all four widths and themes (red Failed marker, the command `exit 3`, the error, Copy); `q2-permissions` Q2-29 test now passes |
| Q2-31 Stop report after steps | **FIXED** | D3 passes in all four combinations: the Stopped report with what was done and Continue is on screen at once, and still there after a reload |
| Q2-30 closed local provider offline | **FIXED** | T4b: the message waits (bubble 1, red failure lines 0, no request) |
| Edited existing file counts | **FIXED** | Changes shows `src/greet.js edited +2 −1` for a replaced line plus one added, and `note.txt new +3 −0`, in git and plain folders, four combinations |
| "Trying..." line | **FIXED** | the status "Bunny Code (offline) is slow. Trying Bunny Large (offline)..." appears at 32 s and stays through the next attempt (no "Streaming..." in between) |
| Q2-7 Plan pane | **still there** | `#pane-plan` is still in `index.html`; the "no dead pane remains" check fails in 8 of 8 combinations until it is removed |
| D1 walk, S-1 walk | 24 of 24, 33 of 33 | |
| Permission tests (mine and `permission-modes`, `exit-status`) | 27 tests, 23 pass, 4 `todo` all passing | |
| Junction write and read escape | still no escape | `test/q2-escape.test.js` passes |

### Open question (UNKNOWN, not counted)

- **Q2-U1.** Headless Chromium reported "Page crashed" / "Target crashed" three times in about ten long walks (at the Settings window, the palette, `page.goto`). It did not repeat when the same rows were run alone, so it may be the test setup (many iframes, parallel runs) and not the app. Needs a look in the real window for a repeat.

## What works (verified, one line each)

- Chat shell: Chat/Code toggle, send (Enter / Shift+Enter), empty send ignored, New chat, row menu (rename, pin, archive, delete listed; rename and archive/restore driven), Incognito (nothing saved), New project and filter, Import (heading format), Archived list, sidebar collapse (button, Ctrl+B), Artifacts panel, Export (downloads `.md`), Popout.
- Account menu: all items; Quit is hidden in the browser build. Settings window: 15 sections (the 16th, Desktop app, is hidden in a browser), search, close by ✕ and Esc, Ctrl+,.
- Composer: attach (chip, remove), permission menu (four modes saved to the chat, keys 1-4), effort, job menu (8 items), model picker and Auto, Stop (keeps the partial in a new chat), message actions (Copy, Retry, Save as artifact, Edit).
- Panes: Terminal (opens in 0.5 s, `echo` answered in about 1 s), Browser (address bar, Back/Forward/Reload, tabs, Copy URL, Open HTML file, Clear history, dev-server card), Tasks (plan with progress), Artifacts, layout menu (dock left, right, bottom, fill).
- Code mode: folder chip, branch chip (`main`), Manual (prompt, Deny keeps the file out, Allow writes it), Accept edits (edit passes, command asks), Undo puts the file back.
- Settings sections: Language (Spanish changes the sidebar), Notifications, Privacy, Capabilities (8 switches), Connection, Models (allowlist and alias take effect), Usage, About (update check answers in 3.6 s).
- Providers: connect with a key, empty key refused ("API key is required"), disconnect, custom provider add. Automation: memory, MCP (bad address refused), schedule, hook, skill add and delete. Customize: tabs, search, Add menu, skill lifecycle.

## Timings (`q2-perf.mjs`, invented profile)

| What | Time |
|---|---|
| First load until the greeting shows | 0.18 to 1.0 s (24 requests: 14 scripts/styles, 8 API; `chat.js` 143 KB, `app.css` 119 KB) |
| API calls on an empty profile | 0 to 13 ms |
| `GET /api/sessions`: 155 chats | 97 ms (69 KB); 317 chats 182 ms (142 KB) |
| Reload with 155 chats until the sidebar lists them | 0.32 s |
| Open a 400-message chat until the last message is in the page | 0.34 to 0.46 s; page memory 10 MB |
| Settings window, one section | about 0.55 s each |
| Slow things | Check for updates 3.6 s; model fallback 122 to 363 s (Q2-10) |

## Not covered (UNKNOWN, on purpose)

- The installed Electron app: native zoom keys, tray, launch at login, the Desktop section, Quit, `window.prompt` (Q2-17), dev tools.
- External sign-in: GitHub (CLI, token, device), Google, OpenCode Go, GitHub Copilot; Ollama; the local connector (runs a program); Plugin from GitHub or file; the "Open in your browser" button for a page that refuses framing; voice input and read aloud (no microphone or speech in the test browser).
- "Compact this chat", Pin, Delete, project rename/delete, drag and drop and paste of attachments, Branch on a message, computer use, helpers, scheduled runs firing.
- Real provider behaviour: model ranking for Auto with real model lists, real rate limits. The audit used a scripted provider.
- Whether the three Chromium crashes (Q2-U1) are the app.

## Tests added (the gate passes with all of them)

- `test/q2-audit.test.js`: 23 tests. 6 plain (Auto writes in the folder, 429 fallback saves the reply, `&&`/`||` translation, dev-server detection, heading import, Tasks/Terminal/Browser wiring). 17 `{ todo: 'Q2-n' }`: Q2-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18. A todo fails today, is reported, and does not fail the gate; when its defect is fixed it passes and the marker comes off.
- `e2e/q2-audit.spec.js`: 17 browser tests. 7 plain (Settings sections and search, rename/archive/incognito, panes and layout, mode and effort saved, Stop keeps the reply, Manual allow/deny/undo, git branch chip). 10 `test.fail()` (Q2-2, 3, 4, 4b, 5, 6, 9, 14, 15, 19): Playwright counts "failed as expected" as a pass and reports "expected to fail but passed" the day the defect is fixed.
- Not in the gate (too slow, 2 to 6 minutes): `e2e/q2-fallback.mjs` (the stall timings above). Run it by hand after the Builder changes the timeouts.

## For the Builder (suggested order, not part of this task)

1. Q2-1 and Q2-2 first (safety). 2. Q2-4, Q2-5, Q2-6 (the three panes): the checkpoint store already has what Changes needs, and `git diff`/`git status` cover repos. 3. Q2-10 to Q2-13 together (one design for how a failing model is abandoned and reported). 4. Q2-19, Q2-8, Q2-9. The rest are small.

## Re-running

```
BUNNY_DATA_DIR=<temp folder> BUNNY_FAKE_UPSTREAM=1 PORT=5392 node src/server/main.js
BASE=http://127.0.0.1:5392 OUT=<temp folder> node e2e/q2-controls.mjs      # also q2-panes, q2-pages, q2-code-mode, q2-perf, q2-inventory
node e2e/q2-make-inventory.mjs <OUT>/inventory.json > docs/plans/audit-q2-inventory.md
```
