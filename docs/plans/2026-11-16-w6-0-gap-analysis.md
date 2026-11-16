# W6-0: what stops Bunny doing the owner's acceptance test today

Researcher, 2026-11-16. Code read at `dfac0db` (origin/main, v0.1.6). Nothing was run against the owner's profile; rea was read on GitHub only, not cloned or run. The target site was fetched once with curl (headers and HTML size only) to learn what it is built with.

The task (plan `043d6e7`, Wave 6): install and switch on `morluto/rea`, ask the use case, recreate https://dennypratama.com/ locally "100%", show it and wait, later apply the learning to the owner's own landing page, all while switching models on failure. Private local test copy, never published.

## 1. What rea is and what it needs (README on GitHub)

- An MCP server + skill + CLI for **reverse engineering** (native binaries, Electron/JS apps, .NET, APKs, firmware, websites, HAR captures). Not a website-cloning tool. Its website analysis is one of many targets.
- Needs **Node.js 22.x (>= 22.23.4), 24.x (>= 24.22.1) or 26.12.1+, plus npm**. Bun only for Bun updates.
- Setup is `npx rea-agents setup`: it edits the *agent's* MCP config and writes workflow instructions for Claude Code, Codex, Cursor, Gemini CLI and others, then asks you to restart the agent. **Bunny is not on that list**, so setup would configure the wrong thing. Bunny must do the registration itself: an MCP stdio server (`npx -y rea-agents ...`; exact serve command UNKNOWN, read from the CLI guide before building) plus the skill text.
- Website analysis needs a **Chrome-family browser** (found by rea, not by Bunny). Static JS analysis needs no native engine. Hopper/Ghidra/IDA, JDK, adb, Docker are for other targets and are not needed for a website.
- Config via env vars (`REA_MCP_OUTPUT_SCHEMA_PROFILE`, `REA_GHIDRA_STARTUP_TIMEOUT_MS`, ...). None needed for the website case.
- First `npx` run downloads the package: slow (Bunny's connector start limit is 60 s, `mcpLocal.js:19`).

Target site facts (UNKNOWN to the model today, found by curl): 200 OK, 72 KB HTML, a **Next.js (Turbopack) app**, with GSAP, WebGL, canvas and three.js mentioned in the HTML. So "100%" means scroll/WebGL animation, not only layout. That is the hardest part, and no tool in either Bunny or Claude Code reproduces it from screenshots alone. Realistic target: pixel-close layout, type, colour and assets, with animations rebuilt from the downloaded JS/CSS.

## 2. The job in steps, and what Bunny has

Legend: **works** / **partial** / **missing**.

| # | Step | Today | Evidence |
|---|---|---|---|
| 1 | Read the rea repo and README | **works** | `read_url` turns a github.com/owner/repo link into its README, clipped to 12,000 chars (`pluginImport.js:138-153`) |
| 2 | Clone the repo, read other files (package.json, docs) | **partial**: only via `run_command` (git), which is the "run" risk and asks per mode | `workspace.js:140-146` |
| 3 | Install deps (npm, pip, git), 2-minute limit | **partial**: `npm install` of a big tree may pass 2 min; the kill is clean, `start_process` exists as the workaround | `workspace.js:333,348`, `processes.js` |
| 4 | Install rea as a plugin | **partial**: `install_plugin` imports skills and remote connectors only; rea is a *local* stdio MCP, so it is skipped | `pluginImport.js:75-86,89-91` |
| 5 | Register rea as a local connector | **partial**: `add_connector` with a command works after the person confirms the exact command; `npx` first start can exceed 60 s | `appTools.js:31`, `mcpLocal.js:19,96,107` |
| 6 | Enable it "for this project" | **missing**: connectors and skills are global, not per project/folder | `skills.js`, `mcpStore.js` (no folder scope) |
| 7 | Ask the use case, then wait | **works** | `ask_user` `agentTools.js:278` |
| 8 | Open the live site and look | **partial**: the browser panel gives text (7,000 chars) and numbered links/buttons/fields; the model sees a picture only if its model has vision | `electron/browserAgent.js:49,108`, `chat.js(ui):2571` |
| 9 | Inspect DOM, CSS, fonts, JS behaviour | **missing**: no HTML source, no computed styles, no font list, no network/asset list, no JS evaluation. `read_url` strips `<script>` and `<style>` and all tags | `pluginImport.js:146-149`; `browserAgent.js` (actions are read/click/type/scroll/screenshot only) |
| 10 | Download assets (images, fonts, video, JS, CSS) | **partial**: only by PowerShell inside `run_command`; no download tool; output clipped to 8,000 chars; `write_file` is text only | `workspace.js:19,136`; no download tool in the tool list |
| 11 | Write many files | **works** (one whole file per call; `edit_file` for patches) | `workspace.js:136-139` |
| 12 | Run a local server, keep it running | **works**; `settle` waits for the printed localhost address | `processes.js:68-80` |
| 13 | Preview the copy beside the original | **partial**: `browser_open` can open `http://localhost:...`, and one tab at a time, so there is no side-by-side | `browserTools.js:21-36` |
| 14 | Compare screenshots | **missing**: the model sees at most the 2 latest pictures (`chat.js:140`), no pixel diff or measured-difference tool; a non-vision model sees nothing | `src/server/chat.js:140` |
| 15 | Show the person and wait | **works** (`ask_user`; the reply ends and the next message continues) | `agentTools.js:278` |
| 16 | 100+ tool steps | **partial**: a reply stops at 30 rounds (code, medium effort), 45 high, 70 max, then forces a final answer without tools; the person must say "continue" | `app.js:2401-2407`, `chat.js(server):65,129-130` |
| 17 | Remember the plan across rounds | **partial**: `update_tasks` shows a checklist; it lives with the reply and is rebuilt only from saved steps | `agentTools.js:250` |
| 18 | Long context | **partial**: every tool result is clipped to 12,000 chars in the live loop (`chat.js:133`) and to **300 chars** when rebuilt from saved steps (`history.js:15`); auto-compaction at 80% uses a model summary | `sessions.js:419`, `app.js:1533` |
| 19 | Fall back to another model on failure | **partial**: works between *sends*; see 3 | `src/ui/chat.js:2392-2440` |
| 20 | Apply the learning to ignitepro.pk later | **partial**: needs a durable note. `remember` and chat memory exist; there is no "write findings to a file and re-read next chat" convention, so it relies on the model doing it | `agentTools.js:202` |

## 3. Model fallback: what is handed over

- Fallback is run **by the window**, not the server: up to 3 attempts, resend with `retry: true`, so the user turn is not saved twice (`ui/chat.js:2397-2440`). A model chosen by hand is used first; Auto ranks four.
- Each tool step is saved as its own message (`app.js:1595-1599, 2293`). On the next attempt `history.js` rebuilds the chat: each turn's steps go back **in shortened form** (each result clipped to 300 chars, steps per turn to 6,000 chars total, oldest cut first: `history.js:15-16,31-34`) and a cut-off turn is marked "This reply was cut off... Steps already done" (`history.js:41-46`).
- So the new model knows *what was done* but not the *content it read*: a 70 KB HTML file, a README, a screenshot, or any list of 50 assets is reduced to a 300-char stub. For a long clone job that is the real handover gap: the second model re-reads files, or works blind.
- The in-flight tool loop is lost: `conversation` is rebuilt from messages, not carried (`chat.js(server):61`). Pictures are not saved with steps for the model (only `attachments` for display), so the next model cannot see the last screenshot unless it takes another.
- Three attempts per send, and then the person must press retry. A job of 100+ steps over a flaky provider can burn all three before step 20. Errors that count as "not the model" do not fall back (`ui/chat.js:2408`).
- There is no "carry on" automatic message: after the final answer or an error, the person types "continue" (fallback attempts 2 and 3 do the equivalent through the saved steps).

## 4. How Claude Code and Cursor would do the same job (for contrast)

(From their public docs and my earlier inventory, `docs/plans/tool-inventory.md`; not re-tested here.)

- **Shell + files** do the heavy lifting: `git clone`, `npm i`, `curl -O` for assets, `Read` with images. Claude Code reads PNG/JPG directly and has no per-result 300-char cap in its own context; output is truncated but with a path to the full file.
- **Browser**: a Chrome/Playwright MCP gives DOM snapshot, `evaluate` (run JS), network log, computed styles, full-page screenshots and console. Bunny's panel has no `evaluate` and no network log. That is the main capability gap for "recreate a site".
- **MCP registration**: `claude mcp add rea -- npx -y rea-agents ...`, per project or user scope. Bunny has no project scope.
- **Subagents and background tasks** keep long jobs going; context is compacted automatically; todo lists are persisted. Bunny has `run_subagent`, `start_session` and compaction, so this is partial parity.
- Neither tool offers "100% pixel-perfect" for a WebGL/GSAP site. They get close by downloading the site's own CSS, JS and assets and serving them.

## 5. Gap list (each becomes a W6 row)

Size: S under half a day, M about a day, L several days. Lane A = permissions, connectors, sandbox. Lane B = tools, processes, the loop.

| Id | The gap | file:line | Proposed fix | Size | Lane |
|---|---|---|---|---|---|
| W6-G1 | The model cannot inspect a page's HTML, CSS, fonts, scripts or network | `electron/browserAgent.js:108` (actions read/click/type/scroll/screenshot); `pluginImport.js:146-149` strips script/style/tags | New read-risk tool `browser_inspect` (HTML of the page or a selector, computed styles for a selector list, `document.fonts`, stylesheet text, list of loaded resources via `performance.getEntriesByType('resource')`); output goes to a file in the folder, not into the reply. Add a `raw: true` option to `read_url` that saves the raw response to a file | M | B |
| W6-G2 | No tool downloads binary files | `workspace.js:136` text-only `write_file`; only PowerShell in `run_command` | `download_file(url, path)` tool: edit risk, http(s) only, inside the folder, size cap (say 50 MB), content-type recorded, loopback/private addresses refused (SSRF) | S | B |
| W6-G3 | A local stdio MCP such as rea cannot be set up reliably from chat | `mcpLocal.js:19` 60 s start limit; `pluginImport.js:75-86` skips local connectors | Raise the first-start limit to 5 min with progress ("downloading rea..."), keep the confirm card for the exact command, and let `install_plugin` return the suggested `add_connector` call for a skipped local connector | M | A |
| W6-G4 | Node 22+/npm is a hidden requirement; rea fails with a hard-to-read error on Node 20 | `workspace.js` (PowerShell prelude has no runtime check) | `check_environment` helper (or run_command preset) that prints node/npm/git/python/Chrome versions, so the model checks requirements before installing | S | B |
| W6-G5 | Connectors/skills are global; "enable it for this project" has no meaning | `skills.js`, `mcpStore.js` | Optional `folder` scope on skills and connectors; the tool list is filtered to the chat's folder | M | A |
| W6-G6 | The 2-minute `run_command` limit and 8,000-char output fit npm/git badly | `workspace.js:19,333,348` | Per-call `timeout_seconds` (max 10 min) with a visible countdown; keep `start_process` for servers; when output is cut, save the whole log to `.bunny/logs/<n>.txt` and say the path | S | B |
| W6-G7 | A reply stops at 30 tool rounds, and the loop then drops tools to force an answer | `app.js:2401-2407`; `chat.js(server):129-130` | In code mode, when rounds run out, end with a "continue" prompt and auto-resume once (visible and stoppable), or raise `code` to 100 at high effort. Tie to the checklist: stop only when `update_tasks` shows all done | M | B |
| W6-G8 | Fallback loses what was *read*: tool results reduced to 300 chars, loop state dropped, screenshots not kept | `history.js:15-16`; `chat.js(server):61,133-141` | Save big results to files (`.bunny/notes/step-N.txt`) and keep the path in the step line; keep the last 2 screenshots with their step so a vision model resumes with them; add a run "handover note" (goal, plan, done, next) written before each fallback by the failed attempt or generated from steps | M | B |
| W6-G9 | Only 3 attempts per send, and a long job cannot resume on its own | `ui/chat.js:2402` | Per-chat attempt budget that resets after a successful tool step; after the budget, one automatic resume prompt ("continue from the steps above") | S | B |
| W6-G10 | No way to compare the copy with the original beyond looking at two pictures | `chat.js(server):140` (2 pictures); `browserTools.js` | `compare_pages(urlA, urlB, width)`: screenshots both at the same width, returns one stitched/overlay image and a numeric difference per band, so the model knows where to fix. Browser panel opens a second tab for side by side | L | B |
| W6-G11 | The model may not see pictures (non-vision model chosen or ranked) | `ui/chat.js:2571` `canSee`; Auto ranks by job | When a job needs pictures (clone a site), Auto must pick vision models only, and the plan note warns if a hand-picked model cannot see | S | B |
| W6-G12 | `read_url` returns 12,000 chars and drops structure | `pluginImport.js:153` | Part of W6-G1; also allow a `max_chars` and save-to-file | S | B |
| W6-G13 | A skill is written text with no way to hold a repo's `references/` unless imported | `skills.js:12-13` (120,000 chars max) | Fine for rea's skill; check its size when built (UNKNOWN) | S | A |
| W6-G14 | Permission prompts: a 100-step job asks many times in `ask`, and `accept` mode is the only way to run unattended; there is no "allow this command pattern for this job" | `app.js:1509-1512`; `tool-inventory.md` row on permission rules | Wave 5's permission rules (W5-1b) cover it: confirm they allow `npm`, `git`, `curl` under a folder rule so the test runs without 50 prompts | S | A |
| W6-G15 | Sandbox: running rea and downloaded JS with `run_command` is unsandboxed | `workspace.js:117`; `2026-11-16-command-sandbox.md` | W3-7 low-integrity build is already planned; this test is the case that needs it (npx runs third-party code). Network stays open, so say so in the confirm card | M | A |
| W6-G16 | Animation fidelity: GSAP, WebGL and canvas cannot be copied from screenshots | the site itself (Next.js build, GSAP/three mentions) | Not a Bunny bug. The plan: download the site's CSS, JS chunks and assets and serve them (fast, close to 100%), or rebuild with the same libraries. The owner should say which counts as "recreate" (a copy of the site's own files, or a rewrite from what is seen). Question for the owner | - | owner |

### What can be rehearsed now without a real provider (for QA)

- Fixture site: a small local page with an image, a web font, one CSS animation and a script. Fixture repo: a tiny git repo with a README and a `package.json` with one dependency. Run under `BUNNY_DATA_DIR=<temp>` and `BUNNY_FAKE_UPSTREAM=1` as the e2e suite does.
- Steps 4-6 can use a stub stdio MCP server (a 20-line node script) in place of rea, to test local connector add, first-start delay, and project scope without the real package.
- Fallback: a fake provider that fails on round 8; assert the second model's history holds the path of what was read (W6-G8).

## 6. Recommended order

1. W6-G1, G2, G6 (lane B): inspect, download, long commands. Without them the job cannot start.
2. W6-G8, G9, G7 (lane B): handover and long-run behaviour. These are the "switch models without losing progress" part of the owner's words.
3. W6-G3, G4, G14 (lane A): rea install path and the permission rules the run needs.
4. W6-G10, G11 (lane B): comparison and vision choice, to move from "looks similar" toward "100%".
5. Ask the owner W6-G16 before building G10.

## 7. Not verified

- rea's exact serve command and tool names (README summary only; the CLI guide was not read). Read before W6-G3.
- Whether the browser panel can load dennypratama.com (frame headers are stripped for sub-frames, `main.js:~178`; bot walls and WebGL in a frame are UNKNOWN).
- Behaviour of every permission mode during a 100-step run.
- Claude Code and Cursor behaviours are from public docs and my earlier note, not re-run.

## Sources

- https://github.com/morluto/rea (README: requirements, `npx rea-agents setup`, supported agents, Chrome-family browser for websites)
- https://dennypratama.com/ (curl: 200, 72,250 bytes, `/_next/static/...` scripts; mentions GSAP, WebGL, canvas, three)
- Plan `043d6e7`, Wave 6; `docs/plans/tool-inventory.md`; `docs/plans/2026-11-16-command-sandbox.md`
