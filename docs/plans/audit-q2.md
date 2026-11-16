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
| Defects | 22 (5 High, 9 Medium, 8 Low) and 1 open question |
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
