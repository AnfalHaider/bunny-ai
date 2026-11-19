# Bunny AI v0.1.14 against the Claude app (with Claude Code) and Cursor

Researcher, 2026-11-20. For the owner: "give me a report of gaps and features vs claude app and cursor vs Bunny AI when done."

## How this was made, and what it cannot claim

- **Bunny's side** is read from origin/main: `README.md`, `docs/FEATURE-TALLY.md` (115 rows, dated 2026-11-12), `docs/plans/2026-11-19-v0.1.14-plan.md` and the wish list, plus earlier CLI-ENGINES notes. **I could not read `docs/releases/v0.1.14-notes.md`**: the project's guard blocks the Researcher role from touching release records, and I did not work around it. The README on main may not yet describe the v0.1.14 engines, so v0.1.14 scope comes from the plan: Claude Code and Codex CLI as engines (Account or Local), SEARCH-PC, WEB-ACCESS in Quick ask, phone layout and the rest. Everything in the plan is "as planned", not "as shipped", until the notes are checked.
- **Claude Code** is from its official docs (`code.claude.com/docs`), read through a helper agent on 2026-11-20. Several pages were read only in part; those lines are marked as such by the helper and I carry UNKNOWN where the page was not read.
- **Claude desktop app and claude.ai** are from `claude.com/pricing`, `claude.com/download`, `claude.com/features/artifacts`, `claude.com/claude-in-chrome` and the help-centre **collection pages only**. The individual help articles were not opened, so article-level detail is UNKNOWN.
- **Cursor** is from **web-search summaries of cursor.com pages** (docs, changelog, pricing). I could not fetch the pages themselves (no fetch tool, and the helper limit was reached), so each Cursor line is a search result summary, not a quote of the page; several came from community-forum posts and are marked "forum". Treat Cursor lines as leads to re-check, not as settled.
- Model names, prices and plan tables are as the pages showed on 2026-11-20 and change often.
- Not run: no product was installed or tested. Bunny's own claims are its README and its test tally, which I did not re-run.

## One-paragraph verdict

Bunny's real edge is **choice and ownership**: 23 providers, any OpenAI-compatible server, local Ollama, automatic model fall-back, keys and chats kept on the PC, no account, and a permission model the owner can read (Deny beats Ask beats Allow). Its real gaps are **reach and depth of the coding workflow**: no IDE or CI integration, no cloud or internet-reachable sessions yet, one operating system, no codebase index, shallower checkpoints than Claude Code, no marketplace and no team sharing. Both rivals depend on a vendor account and their own models or credits; Bunny does not.

## 1. Chat and models

| | |
|---|---|
| **Bunny has, they don't** | 23 named providers plus any OpenAI-compatible server (README); local models through Ollama and other local servers with no key (tally 2.10); a custom provider form (2.20); automatic model choice with fall-back to another model when one is slow or fails, with the hand-over of everything read so far (README); per-message and per-chat model choice, allowed-model lists, per-provider usage (2.12, 2.13); free-models filter; no account needed. Claude Code and Codex CLI as engines in v0.1.14, in Account or Local mode (plan). |
| **They have, Bunny lacks** | **Claude:** Anthropic's own models only on its apps (the pricing page lists Opus, Sonnet, Haiku and Fable; non-Anthropic or local models: UNKNOWN on the app pages); Claude Code lets you change the endpoint (`ANTHROPIC_BASE_URL`) and use Bedrock, Vertex, Foundry, but "changes where requests are sent, not which model answers", and non-Claude support is UNKNOWN ([model config](https://code.claude.com/docs/en/model-config.md)). **Cursor:** its own Composer model and Tab completion (search summary); a bring-your-own-key route with an "Override OpenAI Base URL" field, but forum posts say it is global, breaks Cursor's own models when on, and does not reach local Ollama without a public tunnel (forum, [thread](https://forum.cursor.com/t/setup-ollama-local-model-in-cursor/144687)). So **neither rival beats Bunny on model freedom**; the gap is in models tuned to the product (Tab, Composer, the vendor's agent loop). |
| **Priority** | **Low** for new model plumbing (already the strength). **Medium**: keep the engines path honest about what Anthropic and OpenAI support (spike results). |

## 2. Coding agent

| | |
|---|---|
| **Bunny has** | Code mode with read, regex search, edit (one, all matches, several at once), run tests, a visible plan checklist, **Undo of a reply's file changes**, long-job auto-continue with a token budget and loop stop, helper agents on different models with their chats kept nested, background programs with their own terminal tabs, GitHub tools (README, tally 6.13 to 6.19, 6.24). Engines (v0.1.14 plan): Claude Code and Codex CLI inside Bunny with Bunny's permissions judging each action. |
| **They have, Bunny lacks** | **Claude Code:** git **worktrees** (`--worktree`, subagents with `isolation: worktree`) ([worktrees](https://code.claude.com/docs/en/worktrees.md)); **checkpoints before every prompt with `/rewind`**, though shell and subagent changes are not restored ([checkpointing](https://code.claude.com/docs/en/checkpointing.md)); named **subagents** as Markdown files, built-in Explore and Plan ([sub-agents](https://code.claude.com/docs/en/sub-agents.md)); `plan` mode with approval; background tasks and "agent view" (page not read: UNKNOWN); the **Code tab in the desktop app** shows running servers, local diffs and PR status ([download](https://claude.com/download)); VS Code and JetBrains integrations ([overview](https://code.claude.com/docs/en/overview)). **Cursor:** agent in an IDE with inline diffs; worktrees (`/worktree`, CLI `-w`); subagents, foreground or background, each with its own branch; plan mode that can build in the background; **cloud agents** (renamed from background agents) on their own VM and branch; `/in-cloud` hand-off ([worktrees](https://cursor.com/docs/configuration/worktrees), [subagents](https://cursor.com/docs/subagents), [2.0 changelog](https://cursor.com/changelog/2-0)). |
| **Gap in plain words** | Bunny has one linear checkpoint (Undo once per reply) and no branch-per-task isolation in its own agent (a per-chat working copy exists inside Bunny's data folder; how far it matches worktrees: UNKNOWN, `worktrees.js` is named in the engines spec). No IDE surface, no inline diff review in an editor, no cloud runner. |
| **Priority** | **High:** per-task isolated working copies with a review-and-merge step (Bunny already has the pieces: working copy, Changes pane, checkpoints). **High:** a multi-step rewind (a list of checkpoints, not one Undo). **Medium:** user-defined subagent roles saved as files. **Low:** IDE plugins (a big cost, and Bunny's pitch is a standalone app). |

## 3. Tools: MCP, web, browser, computer use, file search

| | |
|---|---|
| **Bunny has** | MCP servers and OAuth connectors, local connectors run as a program (with the command confirmed), Gmail, Calendar and Drive, web search (DuckDuckGo) with Quick-ask search planned, a **browser panel** the model drives while you watch, **desktop control** (screenshots, click, type), documents with built-in text recognition (PDF, Word, Excel, PowerPoint, EPUB), model-built tools you approve, SEARCH-PC (plan) (README, tally 6.3 to 6.7, 6.14, 6.21, 6.22). |
| **They have, Bunny lacks** | **Claude:** Claude in Chrome (extension; paid plans; clicks, types, fills forms in your signed-in Chrome) ([page](https://claude.com/claude-in-chrome)); computer use in Cowork (help article title only: details UNKNOWN); a built-in Research mode (paid; behaviour UNKNOWN); web search on every plan including Free ([pricing](https://claude.com/pricing)); Claude Code: WebSearch and WebFetch tools, MCP over HTTP, SSE, stdio and WebSocket with local, project and user scopes ([mcp](https://code.claude.com/docs/en/mcp.md)). **Cursor:** codebase indexing and semantic search (not confirmed in the results I could read: UNKNOWN); an in-editor browser (changelog summary, Feb 2026); MCP with team allowlists (search summary). |
| **Gaps** | Control of the person's **real signed-in browser** (Claude in Chrome): Bunny's browser panel is its own. A deep "Research" mode. A semantic code index. |
| **Priority** | **Medium:** a signed-in-browser option (high risk, needs Security). **Medium:** project-wide code search beyond text and regex (an index). **Low:** a Research mode (a prompt and loop pattern more than a feature). |

## 4. Permissions and safety

| | |
|---|---|
| **Bunny has** | Four modes (Manual, Accept edits, Auto, Plan); **Deny, Ask, Allow rules by command or path, global or per folder, "Try a command" dry run**, deny wins and Plan stays read-only; Bunny's own secrets and data folder protected from the agent; important settings changeable only from the app's own window; device levels (Chats, Everything) with idle sign-out and an Activity log; keys under Windows DPAPI (README, tally). Honest limit in the README: "a guard rail... not a sandbox". |
| **They have, Bunny lacks** | **Claude Code:** OS **sandbox** (macOS Seatbelt, Linux/WSL2 bubblewrap) but "On native Windows, Claude Code runs commands unsandboxed" ([sandboxing](https://code.claude.com/docs/en/sandboxing.md)), so on Windows Bunny is level with it; an **auto mode with a classifier**; `dontAsk` and bypass modes; rules `Tool(specifier)`, evaluated deny, ask, allow ([permissions](https://code.claude.com/docs/en/permissions.md)); managed policy for organisations. **Cursor:** `permissions.json` with terminal and MCP allowlists and an "Auto-review" classifier mode; sandbox with a network domain allowlist (search summary, Feb 2026); privacy mode (details UNKNOWN; forum only). |
| **Gaps** | A real OS sandbox for commands (Windows lacks a ready one for all three). A classifier-reviewed "auto" between Accept edits and Auto. Org-level policy files. |
| **Priority** | **High:** a Windows confinement for commands where possible (AppContainer, restricted token or a container route) since this is the biggest safety gap for Auto mode. **Medium:** an "auto-review" mode. **Low:** organisation policy. Bunny's rule model (deny first, three spellings of a command, path real-path checks) is already stronger than the plain allowlists described for Cursor. |

## 5. Memory and projects

| | |
|---|---|
| **Bunny has** | Lasting memory with an editor and privacy switches, suggested memories you accept, projects with instructions, branches, archive, star, search, import and export of chats from other tools, incognito chats (tally 1.12, 1.21, 1.22, 4.x, 6.1, 6.2, 6.11). All local. |
| **They have, Bunny lacks** | **Claude:** Memory on every plan, syncing across devices ([download](https://claude.com/download)); Projects (5 on Free; sharing only on Team and Enterprise) ([pricing](https://claude.com/pricing)); Claude Code **CLAUDE.md** in user, project and local scopes with path-scoped `.claude/rules/`, AGENTS.md fall-back, auto memory per project ([memory](https://code.claude.com/docs/en/memory.md)). **Cursor:** project rules `.cursor/rules/*.mdc` (forum); automations keep a `MEMORIES.md` (search summary). |
| **Gaps** | Repo-resident instruction files that travel with a project and with git (CLAUDE.md or AGENTS.md style): whether Bunny reads them is UNKNOWN from what I read. Cross-device sync (the local-only design excludes it on purpose). |
| **Priority** | **High (cheap):** read `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` from the opened folder as project instructions, shown to the person. **Low:** sync. |

## 6. Artifacts, previews and documents

| | |
|---|---|
| **Bunny has** | Sandboxed live artifacts beside the chat, version history and restore, star, print, thumbnails, charts, the model tests its own artifact in the browser, read many document types (README, tally 3.x). |
| **They have, Bunny lacks** | **Claude:** named artifact types (Design, Slides and Docs on all plans; Sheets, Data and Whiteboards on paid plans, several in beta); export to PowerPoint, Google Slides, Excel, CSV, PDF, MP4, HTML; share by link ([artifacts](https://claude.com/features/artifacts)); file creation with code execution on all plans ([pricing](https://claude.com/pricing)). **Cursor:** Canvases (interactive dashboards beside the chat, re-runnable, shareable as a live snapshot) ([canvas](https://cursor.com/docs/agent/tools/canvas)). |
| **Gaps** | Writing real **.docx, .xlsx and .pptx** files (Bunny reads them; whether it creates them: UNKNOWN from the README), slide and sheet artifact types, sharing a link. |
| **Priority** | **High:** create Office files (a common daily use). **Medium:** a shareable export of an artifact (a file, not a hosted link, to stay local-first). **Low:** whiteboards. |

## 7. Remote access, phone and web

| | |
|---|---|
| **Bunny has** | Phone or another computer on the home network, signed in with a passcode, per-device levels, idle sign-out, Activity log; the app also runs in a browser (`npm start`). Quick-ask floating bar. Phone layout work in v0.1.14 (plan). |
| **They have, Bunny lacks** | **Claude:** Remote Control (phone app or claude.ai/code drives a session on your machine; needs a claude.ai login), Claude Code on the web (cloud VM that keeps running), `--teleport`, iOS and Android apps, macOS and Linux apps ([remote control](https://code.claude.com/docs/en/remote-control.md), [web](https://code.claude.com/docs/en/claude-code-on-the-web.md), [download](https://claude.com/download)). **Cursor:** iOS app, web at cursor.com/agents on any device, an Android PWA (search summary). |
| **Gaps** | **Outside the home network** (OPEN-SIGNIN, deferred to v0.1.15, waiting for the owner's Tailscale test); a native phone app; macOS and Linux; a hosted runner. Windows-only today, and not code-signed (SmartScreen warning). |
| **Priority** | **High:** OPEN-SIGNIN (already planned). **High:** code-sign the installer (trust). **Medium:** macOS (the largest audience gap). **Low:** a hosted runner (conflicts with local-first). |

## 8. Automation: schedules and hooks

| | |
|---|---|
| **Bunny has** | Scheduled tasks that run unattended with tools and leave a chat behind; hooks that run on events (e.g. a message sent); chats that message each other; background chats. |
| **They have, Bunny lacks** | **Claude Code:** hooks with five handler types (command, http, mcp_tool, prompt, agent) across many events including PreToolUse and worktree events ([hooks](https://code.claude.com/docs/en/hooks.md), read in part); cloud scheduled tasks and GitHub-event triggers ("routines", research preview) ([routines](https://code.claude.com/docs/en/routines.md)); `claude -p` headless, SDK, GitHub Actions and GitLab CI (CI pages not read). Claude app: "hand off and schedule tasks" on Pro and up ([pricing](https://claude.com/pricing)). **Cursor:** Automations on a schedule or on events, Bugbot PR review and Autofix, an Agent SDK, a CLI with hooks ([automations](https://cursor.com/docs/cloud-agent/automations), [SDK](https://cursor.com/docs/agent-sdk)). |
| **Gaps** | **Event triggers** (a new PR, an incoming webhook), tool-level hooks (before and after a tool call; Bunny's HOOK-MAP is deferred to v0.1.15), a CLI or SDK to drive Bunny from scripts, PR review automation. |
| **Priority** | **Medium:** HOOK-MAP (planned). **Medium:** a local webhook or file-watch trigger for schedules. **Low:** a Bunny CLI. |

## 9. Extensibility: plugins and skills

| | |
|---|---|
| **Bunny has** | Skills, plugins and marketplaces (plugins the model installs arrive switched off and recorded, P-6), MCP connectors, model-built tools. |
| **They have, Bunny lacks** | **Claude Code:** plugins bundling skills, agents, hooks and MCP servers with an official marketplace added by default ([plugins](https://code.claude.com/docs/en/plugins/overview.md)); skills as `SKILL.md` directories. **Cursor:** plugins bundling skills, subagents, MCP, hooks and rules (Feb 2026) with **team marketplaces** for private plugins (changelog summary: [2.5](https://cursor.com/changelog/2-5)). |
| **Gaps** | Whether Bunny's plugin format is compatible with Claude Code or Cursor plugins and skills: UNKNOWN. Being able to install the large existing pool of `SKILL.md` skills would be a cheap multiplier. |
| **Priority** | **Medium:** read standard `SKILL.md` skills from a folder and run Claude-style plugin manifests if safe (Security review). |

## 10. Collaboration and sharing

| | |
|---|---|
| **Bunny has** | Export and import of chats; open a chat in another window; nothing multi-user by design (everything is on one PC; a signed-in phone is the same person). |
| **They have, Bunny lacks** | **Claude:** Team ($20 or $25 per standard seat, 2 to 150 seats) with shared projects, Docs, Sheets and Whiteboards, SSO, admin connector controls; artifact links for anyone on personal plans ([pricing](https://claude.com/pricing), [artifacts](https://claude.com/features/artifacts)). **Cursor:** Teams plan, shared cloud agent runs by URL, shared canvases, team marketplaces, Bugbot (search summary; Teams prices in the sources were inconsistent: UNKNOWN). |
| **Gaps** | All of it, by design. |
| **Priority** | **Low.** The owner's pitch is one person's machine. A "share a transcript or artifact as a file" button is the only cheap step (**Medium**, with section 6). |

## 11. Performance and polish

| | |
|---|---|
| **Bunny has** | Streaming with a visible working line and thinking trace, "Still working · step N", folded long code, 13 bundled fonts, instant themes, four languages, command palette (Ctrl+K), no-reload chat switching, multi-window, voice input and read-aloud, accessibility labels, installable web app, test gate with about 1,440 unit and 403 end-to-end tests (README), a tally that fails when a feature loses its test. |
| **They have, Bunny lacks** | **Claude:** signed, auto-updating apps on macOS and Windows with enterprise MSI/PKG packaging ([download](https://claude.com/download)). **Cursor:** native editor speed and Tab completion (UNKNOWN on measured numbers). Neither could be measured here. |
| **Gaps** | **Code signing** (SmartScreen warns on every install: the README says so), an enterprise installer, measured startup and long-chat speed against the rivals (not measured by anyone: UNKNOWN). |
| **Priority** | **High:** code signing. **Medium:** a published performance benchmark of Bunny's own (startup, 1,000-message chat). **Low:** enterprise packaging. |

## Next-release shortlist (my reading, in order)

1. **OPEN-SIGNIN** (already planned) and **code signing**: they decide whether others can trust and reach Bunny.
2. **Isolated working copy per task with a review-and-merge step, plus multi-step rewind**: the biggest coding-agent gap.
3. **Create Office files** (.docx, .xlsx, .pptx): common daily use, no rival advantage in cost.
4. **Read `AGENTS.md`, `CLAUDE.md` and `.cursor/rules`** as project instructions, and standard `SKILL.md` skills: cheap, large reach.
5. **Windows command confinement** for Auto mode (research then Security).
6. **HOOK-MAP and event triggers** for schedules.

## What I could not confirm (UNKNOWN)

The v0.1.14 release notes (blocked to my role); whether Bunny creates Office files, reads CLAUDE.md or AGENTS.md, and how its per-chat working copy compares with git worktrees; Claude desktop app article-level details (Memory, Research, computer use, Remote Control plan limits); whether the Claude apps accept non-Anthropic models; Claude Code's computer use, agent view, desktop and CI pages (linked, not read); Cursor's indexing, built-in web search, computer use, privacy mode and exact Hobby limits (search summaries only, partly forum); every price and plan table, which change often; any performance comparison.
