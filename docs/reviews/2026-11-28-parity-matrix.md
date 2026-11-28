# Parity matrix: Bunny AI v0.1.16 against the Claude app

Researcher, 2026-11-28. Asked by the Chief of Staff for the owner: "a test of the application ... what can be simplified and what can be improved, basically what i am striving for is parity with Claude app. also i want bunny to be powerful enough to work on its own and smart."

## How to read this

- **Bunny side:** main at `bb229a0f` (package version 0.1.16). Read from the source and README with `file:line`; the source tree was extracted to a scratch folder and grepped. **Nothing was run, built or tested.** A rating here means "the code and README say so", not "it works in use". The owner's request for a working test belongs to QA's walk; this document is the comparison, not the test.
- **Claude side:** public pages only, read on 2026-11-28: the Claude [release notes](https://support.claude.com/en/articles/12138966-release-notes.md) (newest entry 2026-11-24), the help-centre articles linked in each row, [claude.com/pricing](https://claude.com/pricing), [claude.com/download](https://claude.com/download), and the Claude Code docs for the Code tab (`code.claude.com/docs/en/desktop`, `permission-modes`, `sub-agents`, `checkpointing`, `worktrees`, `mcp`, `memory`, `remote-control`). Rows where I could only see a title or a search-result summary say so; those facts are marked UNKNOWN or "summary only".
- **Ratings:** **Has** = Bunny has an equivalent. **Partial** = some of it. **Missing** = nothing found. **More** = Bunny does more than the Claude app.
- Claude's apps change fast: in September 2026 Anthropic merged Cowork into every conversation ("[Claude Cowork and chat are one Claude](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude)"), so "Cowork" below means that merged experience, rolling out in stages.

## At a glance

| Area | Rating | One-line gap |
|---|---|---|
| 1 Chat and models | **More** | Claude has its own fine-tuned apps and voice mode; Bunny has 24 providers and local models |
| 2 Projects with knowledge | Partial | No project file library with retrieval |
| 3 Memory | Partial | Bunny's memory is deliberate; Claude's is automatic, topic-based and editable |
| 4 Artifacts and their runtime | Partial | No artifact storage, AI-in-artifact, publish link or install-as-app |
| 5 File and image upload | Partial | Smaller limits (8 files, 4 MB images) than Claude (20 files, 500 MB) |
| 6 Research and web search | Partial | Web search and page reading yes; no multi-step Research mode |
| 7 Connectors and MCP | Partial / More | Fewer ready-made connectors; Bunny adds local stdio connectors |
| 8 Skills and plugins | Partial | No directory or marketplace; Bunny installs plugins from GitHub |
| 9 Code | Partial / More | No user-defined sub-agents, no code-review card, no PR auto-fix; Bunny has more engines |
| 10 Computer and browser use | Partial | No per-app approval tiers; no user's own signed-in Chrome |
| 11 Scheduled tasks | Partial | Interval schedules only, local only, no cloud run |
| 12 Mobile and remote | Partial | Home network only (internet sign-in deferred); no native phone app |
| 13 Voice | Partial | Browser speech input (may not work in the desktop shell) and Windows read-aloud; no Claude-style voice mode |
| 14 Sharing | Missing | No share link or published artifact |
| 15 Settings and permissions | **More** | Bunny's rules model is richer; Claude has org policy and an auto classifier on its own models |

## 1. Chat and models

| Feature | Claude app | Bunny (file:line) | Rating | Gap |
|---|---|---|---|---|
| Model choice | Claude models only: the pricing page lists Opus, Sonnet, Haiku and Fable ([pricing](https://claude.com/pricing)); non-Anthropic models in the apps: UNKNOWN | 24 provider entries in `src/providers/catalog.js` (e.g. Ollama at `:264`); any OpenAI-compatible server; Auto model choice and the answering model named in the reply (`src/server/app.js:4451`, `src/providers/providerOrder.js`) | **More** | none |
| Local models | UNKNOWN (not stated on the pages read) | Bunny downloads and runs models itself: `src/server/localRuntime.js:2`, `localModelsReal.js`, `localDownload.js`, `localFit.js` (LOCAL-MODELS) | **More** | prove on real PCs (spike items in the LOCAL-MODELS report) |
| Thinking and effort | Extended thinking; effort levels in Claude Code ([model config](https://code.claude.com/docs/en/model-config.md)) | `src/providers/thinking.js:8,25,28`; effort tiers `src/server/app.js:4427-4428` | Has | per-model support differs |
| Edit, retry, branch, search, incognito | Edit and retry yes; branches: UNKNOWN | `src/server/sessions.js:4-8`, tally rows 1.10 to 1.22 | Has | none |
| Context management | Automatic compaction | `src/server/history.js:2`, auto-compact (`app.js` near `:565`), `shrinkConversation` (`chat.js:99`) | Has | none |
| Coding engines inside the app | Claude Code in the Code tab | Bunny's own engine plus Claude Code and Codex CLI as engines (`src/server/engines/claude-code.js`, `codex.js`, `engines/handover.js:1`) | **More** | engine switch quality is untested here |

## 2. Projects with knowledge

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Project instructions | Yes ([projects](https://support.claude.com/en/articles/9517075-what-are-projects)); 5 projects on Free | Yes: `src/server/projects.js:2-7` (instructions, a folder, project memory) | Has | none |
| Project knowledge files with retrieval | Upload files per project, 30 MB each, retrieval takes over near the window limit ("[RAG for projects](https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects)", paid plans, summary only) | A project may have a folder and memory, "shared recent work" (`projectContext.js:2`); no uploaded file library or retrieval found (grep for knowledge files returned nothing) | **Missing** | project files plus retrieval |
| New "project as one conversation" (beta) | Parallel cloud threads | n/a | Missing | cloud-only idea |
| Folder-resident rules | CLAUDE.md, `AGENTS.md` fallback ([memory](https://code.claude.com/docs/en/memory.md)) | `AGENTS.md`, else CLAUDE.md, one set for every engine (`src/server/folderRules.js:1-10`) | Has | none |

## 3. Memory

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Memory | Entries Claude reads and updates during conversations; shown as **Topics** in Settings > Memory, editable and deletable; health and belief topics stay out unless enabled; works across chat and Cowork ([release notes](https://support.claude.com/en/articles/12138966-release-notes.md), 2026-07-10 and 2026-08) | Facts "written deliberately ... never guessed from a chat" (`src/server/memory.js:2-6`); the model can `remember` (`agentTools.js:210`); memories suggested from a chat are kept only when accepted (tally 6.11) | Partial | no automatic extraction, no topics view, no sensitive-topic switch |
| Project memory | Per project | `src/server/projects.js:6-7`, `MEMORY_KINDS` `:15` | Has | none |
| Search past chats | Yes (chat search) | `search_chats` tool (`agentTools.js:226`) | Has | none |

## 4. Artifacts and their runtime features

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Live artifact beside chat | Yes, all plans; types Design, Slides, Docs, Sheets, Whiteboards (several beta) ([artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them.md)) | Yes: `src/server/artifacts.js:2-6` (versions, restore); sandbox `ui/artifact-content.js:41` ("NEVER allow-same-origin") | Has (HTML and text) | no Slides, Whiteboard or Sheets artifact types |
| Persistent storage in an artifact | Personal or shared, up to 100 MB and 25,000 records on Pro and up | None: the sandbox cannot reach the app or its storage (`artifact-content.js:41`) | **Missing** | by design today |
| AI-powered artifacts and connected apps (MCP) | Artifacts can call Claude and connected apps with approval ([blog](https://claude.com/blog/build-artifacts)) | None found | **Missing** | none of Bunny's tools are reachable from an artifact |
| Publish and share a link | Private by default; share by link on personal plans ([share](https://support.claude.com/en/articles/9547008-publish-and-share-artifacts)) | None found | **Missing** | share |
| Install an artifact as a desktop app (beta, 2026-11-24) | Yes | None | Missing | new feature |
| Office files | Create files with code execution on all plans ([create files](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude)) | Word, Excel, PowerPoint made by Bunny (`src/server/officeMake.js:1-6`, v0.1.15) | Has | none |
| Print and export | Export to PowerPoint, Excel, PDF, HTML and more | Print an artifact (tally 3.6); Markdown and JSON chat export (tally 1.20) | Partial | export formats |

## 5. File and image upload

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Types and limits | PDF, DOCX, CSV, TXT, HTML, ODT, RTF, EPUB, JSON, XLSX, images (JPEG, PNG, GIF, WebP); chat limits 500 MB a file, 20 files, 8000 px, 1000 PDF pages ([upload](https://support.claude.com/en/articles/8241126-upload-files-to-claude.md)) | PDF, Word (incl. .doc), Excel, PowerPoint, OpenDocument, EPUB, RTF, with OCR for scans and pictures (`src/server/documents.js:24` text cap 150,000 characters; `ocr.js`); at most 8 files and 4 MB per image (`src/server/attachments.js:18-19`) | Partial | limits are far smaller; offline OCR is something Claude does not state |
| Vision | Yes | Yes when the model can (`attachments.js:153`) | Has | none |
| Send files to and save files from connected apps (beta, 2026-11-24) | Yes | Gmail drafts and Drive export (`google.js:2-6`) | Partial | general connector file transfer |

## 6. Research and web search

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Web search | On every plan, Free included ([pricing](https://claude.com/pricing)) | `web_search` and `read_url` (`src/server/appTools.js:3,20,31`); Brave (own key), DuckDuckGo, Bing in order with a relevance check and 2-minute cache (`src/server/webSearch.js:2-5`) | Has | quality unmeasured here |
| Research (multi-step cited report) | Paid plans only ([pricing](https://claude.com/pricing)); behaviour UNKNOWN (page not opened) | No dedicated mode; the agent loop can do it ("Look into this and give me sources", README example 5) | Partial | no explicit plan, fan-out and citation report |
| Search this PC | Not found in Claude's apps | `src/server/pcSearch.js:2` (Windows Search index) | **More** | none |

## 7. Connectors and MCP

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Connector directory | Many hosted connectors (Gmail, Drive, M365, Slack ...) on all plans; org admin controls on Team and Enterprise ([pricing](https://claude.com/pricing)) | Remote MCP over streamable HTTP with OAuth (`src/server/mcp.js:2-6`, `mcpOAuth.js`); 9 curated entries (`curatedPlugins.js:10-18`); Gmail, Calendar, Drive (`google.js`); GitHub (`github.js:2-10`) | Partial | fewer ready-made connectors (no Slack, M365, Notion native: via MCP only) |
| Local MCP servers | Desktop extensions give access to local files and apps ([download](https://claude.com/download)); stdio MCP in Claude Code | Local stdio connectors with the command confirmed (`src/server/mcpLocal.js`) | Has / **More** | none |
| Tool discovery | Tool search on by default for MCP ([mcp](https://code.claude.com/docs/en/mcp.md)) | `find_tools` with deferred tools above 40 tools or 30,000 characters (`src/server/deferTools.js:2-6`, `app.js:3215,4102`) | Has | none |

## 8. Skills and plugins

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Skills | Skills for every plan; org skills; security scanning (Enterprise beta) (release notes 2026-08-06) | Skills switched on per chat, slash commands (`skills.js:2-6`); `read_skill` for the model (`appTools.js:3,20`) | Has | auto-invocation by description: UNKNOWN in Bunny |
| Plugins and directory | Plugins bundle skills, connectors, sub-agents; a directory and developer portal (release notes 2026-09) | Import from a GitHub repo in the Claude plugin layout; hooks and scripts are never run (`src/server/pluginImport.js:1-9`); plugins the model installs arrive switched off | Partial | no browsable directory or marketplace |
| Hooks | Rich hook events in Claude Code ([hooks](https://code.claude.com/docs/en/hooks.md)) | Three events (message sent, chat created, reply finished) (`src/server/hooks.js:2-6`) | Partial | no tool-level events (HOOK-MAP is v0.1.16 scope) |
| Tools Bunny builds for itself | Not found | `customTools.js:2-6` (script read and approved first) | **More** | none |

## 9. Code (folders, diffs, worktrees, sessions, sub-agents)

| Feature | Claude app (Code tab) | Bunny | Rating | Gap |
|---|---|---|---|---|
| Folder sessions, terminal, dev server preview | Yes ([desktop](https://code.claude.com/docs/en/desktop.md)) | Code mode in a folder (`workspace.js`), terminal tabs (`terminal.js:2-6`, `processes.js:3`), browser pane (`ui/browser-pane.js`) | Has | none |
| Diff review | Diff view, line comments Claude acts on, **Code review** card with "Apply fixes" ([desktop](https://code.claude.com/docs/en/desktop.md), sections at lines 202-224) | Changes and Files panes with a diff view (`src/ui/work-panes.js:2,48-52`); no line comments or review card found | Partial | line comments and a review pass |
| PR status and auto-fix | PR CI status in the session, Auto-fix and Merge when ready | GitHub tools read PRs and checks and open PRs (`github.js:94-99`); no watching or auto-fix | Partial | CI watch and auto-fix |
| Worktrees | A session in its own worktree (option) | A git worktree per code chat in Bunny's data folder (`src/server/worktrees.js:2-8`) | Has | none |
| Checkpoints and rewind | Checkpoints before each prompt; `/rewind`; shell changes not restored ([checkpointing](https://code.claude.com/docs/en/checkpointing.md)) | A checkpoint per reply that changed files; rewind across replies with preview; commands not tracked (`checkpoints.js:2-6`, `rewind.js:2-9`) | Has | none |
| Plan mode | Yes, with approval | Yes, read-only whatever a rule says (`permissionRules.js:6`) | Has | none |
| Sub-agents | Built-in Explore and Plan; custom agents as files; a subagent may run in a worktree ([sub-agents](https://code.claude.com/docs/en/sub-agents.md)) | `run_subagent` helpers on any model, up to 12 per reply and 2 deep (`agentTools.js:170`, `app.js:3500-3503,3620`) | Partial / **More** | no user-defined sub-agent roles; Bunny can run helpers on different models |
| Parallel sessions | New sessions, split view, a task Claude suggests and starts in another session, cross-session messages ([desktop](https://code.claude.com/docs/en/desktop.md)) | Background chats and chats that message each other (tally 6.16); sub-agent chats nested under the parent | Partial | no suggested-task cards |
| Cloud sessions | Run a session in the cloud, continue elsewhere | None | Missing | local-first design |

## 10. Computer and browser use

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Computer use | Windows and Mac desktop; Pro, Max, Ultra (Team and Enterprise beta, 2026-11-20); off until enabled; **approve each app per session, with fixed tiers** (browsers view-only, terminals click-only) ([computer use](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork.md), [desktop](https://code.claude.com/docs/en/desktop.md)) | Screenshot, click, type, key, scroll, drag via PowerShell (`src/server/computer.js:2-6`); off until switched on; per-app approval or tiers: UNKNOWN (not found) | Partial | per-app approval and tiers |
| Built-in browser | Yes (browsing and forms) | Browser panel the model drives (`electron/browserAgent.js`, `src/server/browserTools.js`) | Has | none |
| The user's own signed-in Chrome | Claude in Chrome, paid plans ([page](https://claude.com/claude-in-chrome)) | None | **Missing** | extension and security work |

## 11. Scheduled tasks

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Recurring and on-demand tasks | Schedule by time ("every weekday at 8 AM"); tasks run **in the cloud** so the computer can be off; pause, resume, run on demand ([schedule](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork.md)) | A task that runs "on an interval" (`src/server/scheduler.js:2`, minimum 1 minute `:13`), with tools unattended (tally 6.23); leaves a chat behind. Calendar times (a weekday and an hour): not found in this module, UNKNOWN in the UI | Partial | calendar schedules, catch-up after the PC sleeps (UNKNOWN), no cloud run |
| Phone-to-desktop handoff | Dispatch (existing users) | None | Missing | needs internet reach |

## 12. Mobile and remote

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Phone access to your desktop | Remote Control from the phone app or claude.ai/code to a session on your machine; Cowork on web and mobile; native iOS and Android apps ([remote control](https://code.claude.com/docs/en/remote-control.md), [download](https://claude.com/download)) | Phone or another computer on the home network behind a passcode, device levels, idle sign-out, Activity log (`src/server/remoteAccess.js:2-12`); installable web app (`ui/install-app.js`) | Partial | **internet reach** (OPEN-SIGNIN, deferred), no native phone app |
| Other platforms | macOS, Windows, Linux (beta) | Windows only | Missing | macOS and Linux |
| Signed installer | Yes, MSIX and PKG packages | Not code-signed (README) | Missing | SmartScreen warning |

## 13. Voice

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Voice | "Voice — Talk to Claude instead of typing" listed on the product page; an Esc-to-end note in the Cowork changelog (search summary; detail UNKNOWN) | Voice input uses the browser's speech recogniser (`src/ui/chat.js:3820-3825`), which may be absent in the desktop shell: UNKNOWN; read-aloud with built-in Windows voices (`src/server/speech.js:2-4`) | Partial | a real voice input and conversation mode |

## 14. Sharing

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Share an artifact or a chat | Artifact links; shared projects on Team and Enterprise; shared artifacts embeddable (release notes) | Import and export of chats only (`src/server/import.js:2-6`) | **Missing** | no sharing; local-first |

## 15. Settings and permissions

| Feature | Claude app | Bunny | Rating | Gap |
|---|---|---|---|---|
| Modes | Manual, Accept edits, Plan, Auto (classifier), Bypass; `dontAsk` CLI only ([permission modes](https://code.claude.com/docs/en/permission-modes.md)) | Manual, Accept edits, Auto, Plan (README); Auto with a **judge** (`src/server/autoJudge.js:2-6`, `app.js:2845`) | Has | no bypass or deny-all mode |
| Rules | Deny, ask, allow per tool; user, project, local scopes; "don't ask again" saves a rule ([permissions](https://code.claude.com/docs/en/permissions.md)) | Deny, ask, allow by command or path, global or per folder, "Try a command" (`src/server/permissionRules.js:1-12`) | Has | none for tool, network-domain or agent rules (see the permissions note) |
| Protected paths | `.git`, `.vscode`, shell profiles, `.mcp.json` ... | Bunny's own data folder and secrets (`workspace.js:233-257`) | Partial | repository config files unprotected: UNKNOWN |
| Settings that work and read clearly | n/a | SETTINGS-OVERHAUL in progress (v0.1.16 direction note) | n/a | QA's audit |

## "Works on its own and smart": how Claude and Bunny run a job

Claude's side is from the docs above; I cannot measure how well either product does it. The comparison is of **mechanisms**, which is what documents can show.

| Capability | Claude (documented) | Bunny today (file:line) | Verdict |
|---|---|---|---|
| **Hand over a whole task** | "Describe the outcome you want, and Claude works through the steps on its own ... without picking a mode first"; several tasks at once ([one Claude](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude)) | Chat and Code modes; the model picks tools; capability map tells it what is on or off and how to get it (`capabilityMap.js:2-6`); `find_tools` loads deferred tools (`deferTools.js:2-6`); `request_capability` card (tally 6.12) | Partial: the person still sets the work mode; the owner's complaint (it "just does not do that") sits here |
| **Plan and task list** | Plan mode; a todo list in Claude Code | `update_tasks` checklist under the reply, up to 40 steps (`agentTools.js:266-274`); open steps trigger a nudge to carry on, up to 3 times (`app.js:4690-4705`) | Has |
| **Sub-agents** | Explore, Plan, custom; parallel; classifier checks each ([permission modes](https://code.claude.com/docs/en/permission-modes.md)) | `run_subagent`, several at once, 12 per reply, 2 deep, own model each (`app.js:2981,3500-3503,3620`) | Has (no custom roles) |
| **Checks its own work** | Claude Code `/code-review` finds problems in the diff; the desktop offers "Apply fixes" ([desktop](https://code.claude.com/docs/en/desktop.md)); a loop of "run tests and fix" is a prompt habit, not a documented mechanism: UNKNOWN | Effort notes ask the model to "check your work" and "verify every step" (`app.js:4427-4428`); in README the tests are run when asked; **no enforced verify step** (nothing found that runs tests after edits before ending) | **Gap**: a built-in "verify before done" step |
| **Long tasks** | Cloud tasks keep running "even if you close your laptop"; local file work needs Desktop open ([one Claude](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude)) | Keeps going without "continue": extends rounds up to the Settings cap (`app.js:4642-4650`), 5,000,000-token default budget (`caps.js:12-13`), long output shortened (`chat.js:99`, 240,000 characters `app.js:4650`) | Partial: only while Bunny and the PC are on |
| **Loop and runaway guard** | Auto mode pauses after 3 blocks in a row or 20 total ([permission modes](https://code.claude.com/docs/en/permission-modes.md)) | Cards at the token budget, the same step 3 times in a row, or 25 rounds without progress (`chat.js:101-118`, `app.js:4661-4690`) | Has |
| **Recovers from errors** | UNKNOWN as a documented mechanism beyond retries | Hands the job to another model when one fails or is silent (README; `waitLimits.js`, `app.js:4451`); a model that refuses tools carries on without them and says so (`app.js:4655-4658`); retries a smaller request when the balance cannot cover it (tally 2.16); a cut-off is continued (tally 6.26) | **More** |
| **Rewind** | `/rewind` | Rewind across replies (`rewind.js`) | Has |
| **Judging risky steps** | Classifier in Auto | Auto judge sees only the person's typed words and the proposed call (`autoJudge.js:2-6`) | Has |
| **Asks only when it must** | `AskUserQuestion`; auto mode "nudges Claude to keep working without stopping for clarifying questions" ([permission modes](https://code.claude.com/docs/en/permission-modes.md)) | `ask_user` with choices (`agentTools.js:297`); nudges when a reply ends asking permission for the job it was given (`app.js:4684-4690`) | Has |
| **Works while you are away** | Cloud scheduled tasks; Dispatch | Scheduler on the local PC only (`scheduler.js:2`) | Partial |

What this says: Bunny already has most mechanisms (task list, loop guards, helpers, rewind, model hand-over, auto judge). The mismatch the owner describes is probably in **selection and follow-through** (the model choosing and enabling the right tool without being asked, and finishing with a check) rather than in missing machinery. That needs the QA walk and the agent-flow work in the v0.1.16 direction note, not more features.

## Top 10 gaps, ranked by value to the owner (S small, M medium, L large)

1. **A built-in "verify before done" step in Code mode** (run the project's tests or build, read the diff, fix and re-run, then report): directly answers "smart and on its own". Everything it needs exists (`run_command`, `update_tasks`, checkpoints). **M**
2. **Project files with retrieval** (a per-project file library the model searches), matching Claude's project knowledge. **M**
3. **Automatic, editable memory** (topics view, model-proposed entries the person confirms, a sensitive-topics switch). Today's suggestions are kept only when accepted, so this is a UI and prompt step on `memory.js`. **M**
4. **Calendar schedules plus catch-up** ("every Monday 8 am", run missed tasks when the PC wakes), and a clear "runs only while Bunny is open" notice. A cloud run is out of scope for local-first. **S to M**
5. **Reach from outside the home network** (OPEN-SIGNIN, already designed and waiting for the owner's Tailscale test). **M**
6. **Artifact runtime: storage and a way to call the model from an artifact**, behind a per-artifact approval. Highest-value artifact feature; sandbox rules (`artifact-content.js:41`) must change with Security. **L**
7. **User-defined sub-agents and suggested-task cards** (a folder of agent files, a "Start in another chat" card). **M**
8. **Review loop in Code:** line comments on the diff that the agent acts on, a review pass, and PR check watching with auto-fix. **M**
9. **Research mode** (a plan, parallel searches through helpers, a cited report with a progress line). Mostly prompt and helper wiring. **S**
10. **Installer trust:** code signing so SmartScreen stops warning; this costs a certificate, which conflicts with the free-only rule (R4), so it is the owner's decision, not a build item. **S, owner decision**

Not on the list on purpose: Claude in Chrome (a large security surface), native phone apps, macOS and Linux (large; Windows first), cloud sessions, team sharing (against the local-first design).

## What I could not confirm (UNKNOWN)

Whether Bunny's UI offers calendar schedules, a computer-use per-app approval or a "don't ask again" rule from a prompt; whether browser speech input works inside the Electron window; Bunny's automatic memory suggestions in practice; what Claude's Research, voice and memory help articles say beyond the release notes and product pages (their individual articles were not opened); whether Claude's apps accept non-Anthropic or local models; any measurement of how well either product picks tools or finishes tasks; the Claude app's own checks of its work, which are not documented as a mechanism. All Bunny ratings are from reading code at `bb229a0f`, not from running it.
