# Tool inventory: Claude Code / Claude desktop vs Cursor vs Bunny AI (R-2)

Researcher, 2026-11-16. Read-only. Bunny code read at `3aae4df` (branch `claude/researcher-529172`, based on `8f01146`).
The owner's request: "make a detailed list of all the tools essential, tools Claude has, or cursor has. vs what bunny is missing."

## How to read this

- **Bunny status words.** *Works* = I read the code and a named test passes. *Read* = I read the code path, no test names it. *Partial* = built, with a stated gap. *Not found* = I searched and found nothing. *UNKNOWN* = I could not tell from code and did not run the app.
- **Evidence I ran:** `node --test test/` gives **tests 318, pass 318, fail 0** (this session). I did not launch the app, so nothing here is "seen working in the UI".
- **Priority:** *essential* = a coding agent is poor without it; *important* = clearly raises quality or safety; *nice* = polish or scale.
- Claude and Cursor columns come from their public docs (links at the end). Where a doc page did not mention a thing, the cell says "not in docs I read", not "absent".

## 1. What Bunny has today (code map)

| Area | Tools / features | Where |
|---|---|---|
| Files (Code mode, inside a chosen folder) | `list_files` (depth 1-4), `read_file` (text plus PDF/Office/RTF with OCR; line ranges), `search_files` (plain text, case-insensitive), `write_file`, `edit_file` (one exact snippet that must appear once) | `src/server/workspace.js:93-117`; risk table `:93-98` |
| Shell | `run_command` (2-minute limit, Windows PowerShell 5.1, `&&` translated, fresh each call) | `workspace.js:117-121` |
| Background programs | `start_process`, `read_process`, `stop_process`, `list_processes` | `src/server/agentTools.js:61-75`, store `src/server/processes.js` |
| Plan / checklist | `update_tasks` shows a checklist under the reply; Tasks and Plan panes | `agentTools.js:236-250`; `src/server/app.js:2187-2191`; `src/ui/chat.js:1625-1660` |
| Asking | `ask_user` (waits for the answer in the same reply), `request_capability` (asks to turn on code mode, computer use, custom tools) | `agentTools.js:278`, `:49-60` |
| Helpers and parallel chats | `run_subagent` (depth 2, per-reply cap, job-based model choice), `start_session` (background child chat), `message_session`, `move_to_new_chat`, `search_chats` | `agentTools.js:151-185,269`; `app.js:1733-1801` |
| Permission modes | auto, ask, accept, plan. Plan offers read tools only. "build" risk always asks | `app.js:1509-1512,1578-1583`; `agentTools.js:20` |
| Undo | Per-reply checkpoint of files changed by `write_file`/`edit_file`; "Undo file changes" button. Commands' changes are not tracked | `src/server/checkpoints.js:1-8`; `app.js:1114-1120`; `chat.js` `undoBar` |
| Web | `web_search`, `read_url` | `src/server/appTools.js:19-21` |
| Browser (in-app panel) | `browser_open`, `_read`, `_click`, `_type`, `_scroll`, `_back`, `_screenshot` (numbered elements) | `src/server/browserTools.js:25-35`; `src/ui/browser-pane.js` |
| Computer use | Windows only: screenshot with screen text, click, type, key, scroll | `src/server/computer.js`; `agentTools.js:76-85`; see `docs/plans/Q1-computer-use-and-plugins.md` |
| MCP | Remote connectors, local connectors (confirm the command), registry search | `src/server/mcp.js`, `mcpLocal.js`, `mcpStore.js`; `appTools.js:31` |
| Skills / plugins | `add_skill`, `read_skill`, `install_plugin`, `search_plugins` (GitHub and MCP registry) | `appTools.js:23-31`; `pluginImport.js`; `skills.js` |
| Custom tools | `create_tool` (a script the model writes, approved every time) | `src/server/customTools.js` |
| Memory / instructions | `remember`, memory screen, standing instructions, project instructions | `agentTools.js:201`; `memory.js`; `app.js:1435-1445` |
| Scheduling | `schedule_task`, `list_scheduled_tasks` (runs only while the app is open) | `agentTools.js:205-210`; `scheduler.js` |
| Hooks | Three events only (`message.sent`, `chat.created`, `reply.finished`), off by default, output kept | `src/server/hooks.js:15` |
| Artifacts | `create_artifact`, `update_artifact`, versions and restore | `agentTools.js:35-47`; `artifacts.js`; `app.js:709-754` |
| GitHub (signed in) | repos, search, issues, PRs, comment, create PR, clone | `src/server/github.js:78-101` |
| Google (signed in) | Gmail search/read/draft/send, Calendar, Drive | `src/server/google.js:29-43` |
| Terminal pane | Person-driven shell, create/write/read | `src/server/terminal.js`; `app.js:1028-1060`; `chat.js:3269` |
| Side panes | Terminal, Diff ("Changes"), Browser, File, Tasks, Plan, Artifacts, Session rail | `src/ui/index.html:261-363`; `chat.js:123` |
| Other | Dev-server detection, git branch of the folder, project folders, usage, import, update check | `workspace.js:152,359`; `app.js:1184-1192` |

**Two findings about the panes.** The Diff ("Changes") pane and the File pane have markup (`index.html:312-315,354-356`) and CSS (`app.css:1241-1243`), but a search of `src/ui/*.js` for `diff-content`, `pane-diff`, `file-content` and `pane-file` finds no code that fills them. They may show an empty state only. UNKNOWN until someone opens them in the app. There is also no server route that produces a diff (`grep "git diff\|'diff'"` in `src/server` and `src/ui` found nothing).

## 2. The master table

Columns: Claude = Claude Code and Claude desktop. Cursor = Cursor agent (IDE, CLI, cloud). Bunny status is from section 1.

| # | Capability | Claude | Cursor | Bunny (status, file:line) | Gap | Priority and reason |
|---|---|---|---|---|---|---|
| 1 | Read files | `Read` incl. images, PDFs, notebooks | Read files, images | **Works**: `workspace.js:109`, OCR/Office via `documents.js`; `test/documents.test.js` | None | Have it |
| 2 | Write / create file | `Write` | Edit files | **Works**: `workspace.js:113`; checkpointed | None | Have it |
| 3 | Targeted edit | `Edit` (exact string; replace-all) | Suggest and apply edits | **Partial**: `workspace.js:115`, one match only, no replace-all, no multi-edit | Several small edits mean several calls | important: fewer round trips |
| 4 | Find files by pattern (glob) | `Glob` | Search files and folders by name | **Partial**: `list_files` depth 1-4 only (`workspace.js:106`); no pattern | Cannot find `**/*.test.js` | **essential**: first step of any unfamiliar repo |
| 5 | Search file contents with regex, filters, context lines | `Grep` (ripgrep: regex, glob/type filter, -A/-B, counts) | Instant Grep (regex, word boundary, local index) | **Partial**: `search_files` plain text only, no regex or file filter (`workspace.js:111`) | No regex, no `-C`, no file-type filter, no result limits | **essential**: regex search is the main way an agent finds code |
| 6 | Semantic / embedding search | Not in docs I read (uses Grep/Glob plus an Explore subagent) | Docs say search uses no embeddings: "does not store embeddings"; Explore subagent for broad search | **Not found** | None needed | nice: neither product leans on it today |
| 7 | Run shell command | `Bash`, `PowerShell` (permission rules, sandbox) | Terminal with sandbox and run modes | **Works**: `run_command` (`workspace.js:117`); Windows-only PowerShell 5.1; 2-minute cap | No sandbox; no command allow/deny patterns; no persistent cwd | **essential** (have). important: allow/deny patterns, because "ask" prompts every command |
| 8 | Background processes and reading their output | `Bash run_in_background`, `Monitor` (stream lines back), `TaskStop` | Terminal monitoring; background subagents | **Works**: `start_process/read_process/stop_process` (`agentTools.js:61-75`) | No push of new output; model must poll with `read_process` | important: `Monitor`-style push saves polling |
| 9 | Subagents / delegation | `Agent` (own context, custom agents, teams) | Subagents (foreground/background, custom, Explore) | **Works**: `run_subagent` (`agentTools.js:162`; `test/team.test.js`) | No custom saved agent definitions; depth 2 | important: custom agents are how teams reuse roles |
| 10 | Parallel sessions | desktop sessions, `SendMessage`, `ListAgents`, worktrees | Agents window, cloud agents in parallel | **Works** inside the app: `start_session`, `message_session` (`agentTools.js:156,172`) | No isolated git checkout per session | important |
| 11 | Worktree isolation | `EnterWorktree`, `ExitWorktree` | Worktrees (Agents window, CLI, `.cursor/worktrees.json`) | **Not found** (`grep worktree src/server` is empty) | Parallel writing chats can overwrite each other in one folder | **essential** for parallel code work; the project's own family relies on it |
| 12 | Plan mode | `EnterPlanMode`/`ExitPlanMode` with approval | Plan Mode (Shift+Tab, editable plan, "build") | **Partial**: plan permission mode, read tools only (`app.js:1509,1578`); a Plan pane exists | No explicit "present plan, approve, then build" hand-off; unverified how the Plan pane fills | important |
| 13 | Task checklist | `TaskCreate/Update/List/Get`, `TodoWrite` | Checklist inside Agent view | **Works**: `update_tasks` (`agentTools.js:236-250`, `app.js:2187`) | No dependencies or persistence across chats | Have it |
| 14 | Ask the user a question mid-task | `AskUserQuestion` | Ask questions (agent keeps working) | **Works**: `ask_user` (`agentTools.js:278`; `test/ask.test.js`) | Bunny waits; Cursor continues other work | nice |
| 15 | Checkpoints / rewind | `/rewind` restores code and/or conversation; 100 per session | Checkpoints, restore from the timeline | **Partial**: file undo per reply (`checkpoints.js:1-8`) | Only `write_file`/`edit_file`; files changed by `run_command` are not tracked; no conversation rewind | **essential**: a shell that rewrites files without an undo is the main way to lose work |
| 16 | Permission modes | default, acceptEdits, plan, auto (classifier), dontAsk, bypass | Run modes: Auto-review, Allowlist, others; sandbox | **Partial**: ask/accept/auto/plan (`app.js:1509-1512`) | No rule patterns (`Bash(npm run *)`), no path scopes, no classifier, no sandbox | **essential**: patterns turn "ask for everything" into usable |
| 17 | Hooks | Many events (pre/post tool use, session, stop), can block | Hooks: `preToolUse`, `beforeShellExecution`, subagent events etc., can block | **Partial**: 3 events, no blocking, no tool-level events (`hooks.js:15`) | Cannot gate a tool call | important: needed for safety rules (for example block `git push --force`) |
| 18 | Skills | `Skill` tool, SKILL.md | Skills | **Works**: `add_skill/read_skill` (`appTools.js:25-29`; `test/plugins.test.js`) | None obvious | Have it |
| 19 | Plugins / marketplace | Plugins and marketplaces | Plugins | **Partial**: GitHub install, search only (see Q1 note) | No curated catalog, no pinning, no update | important |
| 20 | MCP (tools, resources, OAuth) | Servers, resources (`ListMcpResourcesTool`, `ReadMcpResourceTool`), tool search | MCP, MCP OAuth in SDK | **Works**: remote and local connectors (`mcp.js`, `mcpLocal.js`; `test/local-mcp.test.js`) | MCP resources not read; servers needing sign-in "cannot connect yet" (`pluginImport.js` search note) | important: OAuth connectors are most of the useful ones |
| 21 | Rules / project instructions | `CLAUDE.md`, `AGENTS.md`, `.claude/rules/` | `.cursor/rules`, `AGENTS.md`, user and team rules | **Partial**: project instructions and standing instructions (`app.js:1435-1445`) | Does not read `AGENTS.md`/`CLAUDE.md` from the folder (no match in `src/server`) | **essential**: this is how a repo teaches the agent its rules |
| 22 | Memory | Auto memory plus `CLAUDE.md` | Rules; memories feature not in docs index I read | **Works**: `remember`, memory screen (`memory.js`) | No automatic notes by design (`memory.js:1-10`) | Have it (deliberate choice) |
| 23 | Web search | `WebSearch` | Web | **Works**: `appTools.js:19` | None | Have it |
| 24 | Web fetch | `WebFetch` (domain permissions) | Fetch | **Works**: `read_url` (`appTools.js:21`) | No per-domain permission | nice |
| 25 | Browser control | Chrome extension; desktop browser pane | Browser tool (navigate, interact, screenshot) | **Works**: 7 `browser_*` tools (`browserTools.js:25-35`; `test/browser-tools.test.js`) | Reads numbered elements; no console or network read | important: dev debugging needs console and network |
| 26 | Computer use | Desktop app on macOS and Windows; CLI macOS | Cloud agents can use computers | **Partial**: Windows only, thin tests (see Q1 note) | One test of screen text only | important |
| 27 | Artifacts | `Artifact` (private HTML pages on claude.ai) | Canvas | **Works**: `create_artifact` (`agentTools.js:35`; `test/artifacts.test.js`) | None | Have it |
| 28 | Scheduled tasks | `Cron*`, `/loop`, routines in the cloud, desktop schedule | Cloud-agent automations | **Partial**: `schedule_task` runs only while the app is open (`scheduler.js`; `agentTools.js:205`) | No run when the app is closed | nice: acceptable for a desktop app |
| 29 | LSP / code intelligence | `LSP` (definitions, references, type errors) | Diagnostics/lints (not in the docs index I read) | **Not found** (`grep lsp\|diagnostic` in `src/server` is empty) | No go-to-definition or compile errors except by running a command | important: agents fix more first time when they see errors |
| 30 | Lint / test feedback after edits | via hooks, LSP | agent reads lints (not confirmed in docs I read) | **Not found** as a built-in; `run_command` can run them | Model must remember to run them | important |
| 31 | Git operations | via `Bash`, GitHub MCP | Source control tab, Agent Review | **Partial**: only through `run_command`; GitHub API tools exist (`github.js:78-101`) | No diff or commit helpers; Diff pane unfilled (see above) | **essential**: seeing "what changed" is basic |
| 32 | Code review | `/code-review`, `ReportFindings` | Agent Review, Bugbot (PR reviews) | **Not found** | None | nice |
| 33 | Background / cloud agents | Remote sessions, cloud routines | Cloud agents in VMs | **Not found** | Out of scope for a local app | nice |
| 34 | Steer a running agent / queue messages | Type while it works | Queue plus "send now" | UNKNOWN (not checked in `chat.js`) | | nice |
| 35 | Notifications | `PushNotification` | Cloud notifications | **Not found** | No desktop toast when a long job finishes | nice |
| 36 | Image generation | not a Claude Code tool | Image generation tool | **Not found** | | nice |
| 37 | Tab completion (inline completions in an editor) | n/a | Cursor Tab | **Not found** (Bunny has no editor) | Not applicable | nice: not a fit for a chat app |
| 38 | Voice | voice in Claude apps | Voice chat | **Works** via the browser's speech (`speech.js`, STATUS) | | Have it |
| 39 | Sandbox for commands | Bash sandbox | Terminal sandbox, run modes | **Not found** | | important: pairs with row 16 |
| 40 | Usage and context meter | `/context`, `/cost` | Usage in settings | **Works**: context meter, usage (`usage.js`; rail) | | Have it |

## 3. The shortlist the owner asked for

**Essential and missing or weak (do first):**
1. **Regex search with filters (row 5) and glob (row 4).** Plain-text-only search cannot find `function \w+Handler`. Small change in `workspace.js`.
2. **Read `AGENTS.md` / `CLAUDE.md` from the working folder (row 21).** Bunny's own rules would then reach any agent working in a folder.
3. **Permission rules by command and path (row 16) plus an undo that covers `run_command` (row 15).** Together they make "auto" safe enough to use.
4. **Worktree isolation for parallel code chats (row 11).**
5. **A working Changes pane backed by `git diff` (row 31).** The pane exists but I found nothing that fills it.

**Important next:** multi-edit and replace-all (row 3), push-style process output (row 8), blocking hooks on tool calls (row 17), MCP sign-in connectors (row 20), errors and diagnostics after edits (rows 29-30), browser console and network (row 25), sandbox (row 39).

**Nice / not a fit:** cloud agents, code review bot, tab completion, image generation, push notifications.

**Where Bunny is already at parity or ahead:** artifacts, memory by choice, task checklist, `ask_user`, subagents, in-app browser, Gmail/Calendar/Drive and GitHub tools, skills. Cursor and Claude Code have no equivalent of the Gmail/Calendar/Drive tools in their built-in lists.

## 4. What I did not verify

- I did not run the app, so every Bunny status is from code plus the unit tests (318 of 318 pass).
- The Diff, File and Plan panes: no filling code found; unverified by looking at them.
- Cursor docs: the index (`cursor.com/llms.txt`) I read has no page for Tab, memories, checkpoints or codebase indexing under those names. Checkpoints appear in the Agent overview page. Anything marked "not in the docs I read" may exist in another page or a newer release.
- Cursor's `cursor.com/docs/agent/tools.md` redirected; the tool list came from `cursor.com/docs/agent/overview.md`.

## Sources

- Claude Code tools: <https://code.claude.com/docs/en/tools-reference> (tool table: Agent, AskUserQuestion, Bash, Cron*, Edit, EnterPlanMode, EnterWorktree, Glob, Grep, LSP, Monitor, PowerShell, Read, Task*, WebFetch, WebSearch, Write, Workflow, Artifact, PushNotification)
- Checkpoints: <https://code.claude.com/docs/en/checkpointing.md>
- Permission modes: <https://code.claude.com/docs/en/permission-modes.md>
- Memory: <https://code.claude.com/docs/en/memory.md>
- Computer use: <https://code.claude.com/docs/en/computer-use.md>; desktop: <https://code.claude.com/docs/en/desktop.md>
- Scheduled tasks: <https://code.claude.com/docs/en/scheduled-tasks.md>, <https://code.claude.com/docs/en/routines.md>
- Hooks: <https://code.claude.com/docs/en/hooks-guide.md>; subagents: <https://code.claude.com/docs/en/sub-agents.md>; worktrees: <https://code.claude.com/docs/en/worktrees.md>
- Cursor agent: <https://cursor.com/docs/agent/overview.md>; search: <https://cursor.com/docs/agent/tools/search.md>; terminal: <https://cursor.com/docs/agent/tools/terminal.md>; plan mode: <https://cursor.com/docs/agent/plan-mode.md>; Agent Review: <https://cursor.com/docs/agent/agent-review.md>
- Cursor rules <https://cursor.com/docs/rules.md>; subagents <https://cursor.com/docs/subagents.md>; hooks <https://cursor.com/docs/hooks.md>; Bugbot <https://cursor.com/docs/bugbot.md>; cloud agents <https://cursor.com/docs/cloud-agent.md>; worktrees <https://cursor.com/docs/configuration/worktrees.md>; run modes <https://cursor.com/docs/agent/security/run-modes.md>
