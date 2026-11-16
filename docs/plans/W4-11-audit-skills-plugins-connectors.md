---
title: W4-11 audit: does Bunny really use every skill, connector and plugin?
author: tech-lead
date: 2026-11-17
for: Chief of Staff, Builder B (builds from this spec), Security (items marked SEC)
status: read-only audit of origin/main 2400629 (v0.1.7 plus docs). No code was run for it; the evidence is the code at the lines given.
owner's words (2026-11-17): "we need to ensure that bunny properly uses all plugins skills and connectors"
---

# Scope and method

For each of **skills**, **local connectors** (a program speaking MCP over stdin/stdout), **remote connectors** (MCP over HTTP) and **plugins** (a GitHub repository installed as skills plus remote connectors), I followed three steps in the code:
**offered** (does the model get its name and description), **called** (does a call reach it), **returned** (does its result come back usable), and then the paths: Chat, Code, Auto, helper agents, scheduled runs, and the provider paths.
Line numbers are `src/server/...` at 2400629 unless a path says otherwise. Severity: **H** = a whole kind of thing does not work, or a request fails; **M** = often wrong or lost; **L** = polish. SEC = touches secrets, auth or a security control (needs Security's eyes).

## What works (so Builder does not break it)

- Skills text is added as a system message to every reply in Chat and Code (`app.js:1646-1647`); a long skill is named and read on demand with `read_skill` (`skills.js:95-111`, `appTools.js:93-97`).
- Connector tools are offered in Chat and Code from the cached list (`app.js:1837`, `1883-1899`), called through `mcpCallTool` (`app.js:244-245`, `2546`), and held to the permission mode (`app.js:2508-2536`: Plan hides non-read-only tools at `1895`, Manual and Accept edits ask, Auto does not).
- A call to a tool that was not offered never runs (`app.js:2471-2474`).
- A scheduled run goes through the same chat route (`app.js:404-416`), so it gets the same skills and tools (look-only unless the schedule is set to make changes).
- A helper agent gets the main reply's tools (`app.js:2049`, `toolDefinitions.filter(allowed)`), including connector tools and `read_skill`.
- The `fake` upstream returns text only, by design (tests).

# The gaps, numbered

Each item: where it is, what goes wrong, the fix, and the test that proves the fix. Test files are new unless named. "Fake MCP server" = a small stdio or HTTP test server the test starts (the repository has `test/fixtures/mcp-echo-server.mjs` as a base).

## A. Skills

**S-1 (H). A long skill is cut in the middle before the model sees it.** `read_skill` returns up to 60,000 characters (`appTools.js:93-97`), but every tool result passes `clip(String(result), 8000)` (`app.js:2551`), and `clip` keeps the first 25% and the last part and removes the middle (`clip.js:5-11`). A skill of 20,000 characters arrives with about 12,000 characters missing, and `read_skill` has no way to ask for a part. Imported plugin skills with their `references/` appended run to 120,000 (`pluginImport.js:63-71`).
Fix: give `read_skill` an `offset` and `part` (or section) argument and return one slice of at most 8,000 characters with "part 2 of 5, call again with part 3"; exempt it from the middle cut.
Test: `test/skills-use.test.js`: add a skill of 30,000 characters with a marker string in the middle; run a fake-provider reply that calls `read_skill` for each part; assert every part's text reaches the model's tool message and the marker appears in one of them, and that no result contains "characters left out".

**S-2 (H). Skills imported from plugins often have no description, so the model cannot tell when to use them.** The front-matter reader only accepts `key: value` on one line (`pluginImport.js:26-28`); the very common `description: >` or `description: |` blocks give an empty string. An empty description shows as `- name: ` in the index used when more than 12 skills are on (`skills.js:101-103`) and as "(no summary)" for a long skill (`skills.js:109`).
Fix: read YAML block scalars (`|`, `>`, `>-`, `|-`) and quoted multi-line values in `frontmatter()`; if the description is still empty, use the first non-heading sentence of the skill body (up to 200 characters).
Test: extend `test/plugin-import.test.js` (or add it): a fake repository tree with three SKILL.md files using one-line, `>-` folded and `|` literal descriptions; assert all three imported skills have a non-empty description equal to the expected text.

**S-3 (M). The compact index cuts to 140 characters and gives no hint of when to use a skill.** `skills.js:102`. With more than 12 skills the model sees `name: first 140 characters` only. Fix: include the whole 200-character description (the store already caps at 200, `skills.js:55`) and, when a skill has "when to use" text, keep that first. Test: with 13 skills, assert the system text contains each skill's full description.

**S-4 (M). A skill cannot be called by the person.** `skills.js:4-6` says a skill "appears as a slash command", but `COMMANDS` in `src/ui/chat.js:2620-2626` holds only compact, clear, export, new and help, and `src/ui/chat.js` has no skill handling at all. The person can switch a skill on or off globally in Customize, nothing more. Fix: `/<skill name>` entries in the slash menu (from `/api/skills`, enabled ones); choosing one sends the message with a hidden line "The person asked for the skill X: call read_skill for it first and follow it." Test: `e2e/skills-slash.spec.js`: with two skills on, type `/` and see both listed; send `/my-skill do x` and assert (fake provider) the model's first tool call is `read_skill` for that name.

**S-5 (M). Helpers do not know which skills exist.** `runHelper` builds its own system message (`app.js:2035-2044`) and does not include the skills text, memory, project instructions or the person's standing instructions that the main reply has (`app.js:1637-1647`). A helper is told to "do the task completely" but cannot discover skill names; `read_skill` needs a name. Fix: put the skills index (the compact form) and the person's standing instructions into `helperHistory`. Test: start a helper through the fake provider with one skill on; assert the helper's request contains the skill name and description.

**S-6 (L). `read_skill` ignores the "skills off" switch.** With `skillsEnabled === false` the text is dropped (`app.js:1646`) but `read_skill` still finds a skill by name (`skills.js:114-117` looks in all, enabled or not). It also loads a skill that is switched off. Fix: `find` for `read_skill` should require `enabled` and the global switch. Test: disabled skill returns "There is no skill called X".

## B. Remote connectors (MCP over HTTP, `mcp.js`)

**R-1 (H, SEC). A remote connector cannot sign in at all.** The store's `add` takes no headers (`mcpStore.js:42-67`) and `update` changes only name, url and enabled (`:66-82`); `callTool` and `listTools` send `server.headers` (`mcp.js:36`, `:79`) but nothing ever sets it. The registry search itself says "needs sign-in, Bunny cannot connect it yet" (`pluginImport.js:127`). Every hosted MCP server that needs a token (most of the useful ones) cannot work. The W3-6 sign-in is built on a separate branch (`claude/builder-a-w3-6-final`, 1a1c364, in review) and is not on main.
Fix: land W3-6 (OAuth or token, kept in the DPAPI secret store, never in `mcp.json`), and make `mcp.js` send `Authorization` from the secret store; refresh on 401 once. Test: fake HTTP MCP server that answers 401 without `Authorization: Bearer test-token` and the tools list with it; add the connector with a token; assert the tools are listed and a call returns; assert the token is not present in `mcp.json` or in any `/api/mcp` answer.

**R-2 (H). No `initialize` handshake and no session.** `mcp.js:22-62` and `:65-107` send `tools/call` and `tools/list` as the first message. The streamable-HTTP protocol expects `initialize`, then `notifications/initialized`, then an `Mcp-Session-Id` header (and `MCP-Protocol-Version`) on later requests; many servers answer 400 or 404 without it, and the local client already does the handshake (`mcpLocal.js:73-78`). Fix: one `initialize` per server (cached per run), send the session id and protocol version, handle 404 by starting a new session. Test: fake server that refuses any request without a session id; assert list and call succeed, and that a server restart (session gone) is recovered once.

**R-3 (H). A tool name that the provider rejects breaks the whole chat.** `toToolDefinitions` uses `prefix__name` as the function name with no checking (`mcp.js:135-143`). OpenAI-style APIs require `^[a-zA-Z0-9_-]{1,64}$`; MCP tool names may contain `.` and `/` and may be long, the prefix takes up to 24 characters (`mcp.js:147-153`), so the combined name can pass 64. One bad name makes the provider answer 400 for **every** message while that connector is on. Fix: sanitise to the allowed characters, shorten to 64 with a short hash, keep a map back to the real name (`toolIndex` already holds `tool.name`). Test: fake connector with tools `a.b/c` and a 70-character name; assert the definitions sent to the fake provider all match the pattern, and a call to each reaches the right tool.

**R-4 (H). Two connectors with the same name give duplicate function names.** `toolIndex.set(definition.function.name, ...)` overwrites silently (`app.js:1898`) and both definitions are pushed (`app.js:1897`); providers reject duplicate names. Reinstalling a plugin makes this easy, because there is no check for an existing connector or skill (`appTools.js:80-86`, `mcpStore.js:42-67`). Fix: unique prefixes (suffix `_2`), refuse to add a connector with the same url, and on plugin reinstall update instead of add. Test: add the same plugin twice (fake fetch); assert one set of skills and connectors, and with two connectors of the same name that the offered definitions have unique names.

**R-5 (M). Only the first page of tools is read.** `mcp.js:93`: no `nextCursor` loop (same for local, `mcpLocal.js:98-99`). A server with a long tool list loses the rest silently. Test: fake server paging 3 tools per page for 10 tools; assert all 10 listed.

**R-6 (M). The answer is not matched to the request.** `readPayload` takes the first `data:` frame of an event stream (`mcp.js:115-123`): a server that sends progress or log notifications first has its real answer ignored or the notification parsed as the answer. Fix: read the stream until a message with the request id and a `result` or `error`. Test: fake SSE server that sends two notifications before the answer.

**R-7 (M). Calls cannot be stopped.** `mcpCallTool(...)` at `app.js:2546` gets no abort signal (`mcp.js:22` has its own 30-second timer only; `mcpLocal.js:107-110` 120 seconds). Pressing Stop ends the stream but the reply waits for the tool; a local tool keeps running. Fix: pass `controller.signal`, abort the HTTP request, send `notifications/cancelled` to local servers. Test: fake tool that sleeps 20 seconds; abort the reply after 1 second; assert the reply ends within 3 seconds and the fake server saw the cancel.

**R-8 (M). The 400-character tool description cap and unvalidated schemas.** `mcp.js:96`, `mcpLocal.js:101`: descriptions are cut to 400 characters (often mid-sentence) and the schema is passed as is (`mcp.js:141`); providers reject some keys (`$schema`, a missing `type`). Fix: raise to 1,000 characters, clean the schema (always an object with `type`, drop `$schema`). Test: schema containing `$schema` and no `type` becomes valid; description of 900 characters is kept whole.

## C. Local connectors (`mcpLocal.js`, `mcpStore.js`)

**L-1 (H). The server's own instructions never reach the model.** The `initialize` answer carries `instructions` meant for the model; `mcpLocal.js:73-78` throws the result away (and the remote client never calls it, R-2). Fix: keep `instructions` (cap 2,000 characters) and add them to the system text under the connector's name. Test: fake server returning `instructions: "Use paths relative to C:\\notes"`; assert the text is in the system message of the next reply.

**L-2 (M). The model is not told what connectors exist.** Only the tool list carries them (`app.js:1837-1899`). A connector with no cached tools, in error, or hidden by Plan mode (`app.js:1895`) is invisible, and the model cannot tell the person "your X connector is down". Fix: a short system line: "Connectors: A (4 tools), B (not connected: reason), C (switched off in Plan mode: change mode to use)". Test: with a failing connector, assert the line names it and the reason.

**L-3 (M). A tool list is cached for good, and a failed connector is never retried in chat.** `app.js:1885`: tools are asked for only when none are cached **and** the status is not `error`; the only refresh is the "Check" route (`app.js:955-966`). A server updated after install keeps old tools; a server that was down once stays out until the person presses Check. Fix: refresh at most once an hour or on a call failure with "unknown tool", and retry an errored server once per reply with a short timeout. Test: fake server changes its tool list; assert the next reply offers the new list; a connector that failed and then comes back is offered again without a manual check.

**L-4 (M, SEC). Local connector secrets are stored in plain text.** `mcpStore.js:42-50`/`cleanLocal` put `env` values (often API keys) into `mcp.json` in the profile folder, unlike provider keys (DPAPI). Fix: store env values in the secret store and keep only the names in `mcp.json`. Test: add a connector with `env: {TOKEN: "test-secret"}`; assert the string does not appear in `mcp.json`, and the spawned fake program still receives it.

**L-5 (M). A local connector cannot be edited, and it cannot answer the server's own requests.** `mcpStore.js:66-82` ignores `command`, `args`, `env` in an update; `mcpLocal.js:49-50` ignores messages from the server that have an id and a method (ping, roots/list, sampling). Fix: allow edits through the same confirm step as adding; answer `ping` and `roots/list`. Test: fake server that sends `ping` and waits; assert it gets an answer.

**L-6 (L). A tool "annotation" decides Plan mode.** `readOnly` comes only from `annotations.readOnlyHint` (`mcp.js:98`, `mcpLocal.js:103`). Most servers set none, so in Plan mode their tools are hidden (`app.js:1895`) and in Manual every call asks. Not a bug, but combine with L-2 so the person is told. No code test beyond L-2.

## D. Results, for every connector (`app.js:2546-2551`)

**D-1 (H). The raw JSON-RPC result is turned into text.** `JSON.stringify(await mcpCallTool(...))` (`app.js:2546`) hands the model `{"content":[{"type":"text","text":"line1\\nline2"}],"isError":false}`: text in JSON escapes, no use of `structuredContent`, and `isError: true` is reported as a **done** step (status stays `done`, `app.js:2539-2550`). Fix: one `mcpResultText(result)`: join text parts, render `resource` parts as text or a link, put `structuredContent` as indented JSON when there is no text, and mark `isError` so the step status is `failed` and the model is told "the tool reported an error: ...". Test: fake tool returning two text parts, one structured result, and one `isError`; assert the model's tool message is plain text and the failed step shows as failed.

**D-2 (M). Images from a connector are lost.** MCP `image` content is base64 inside the JSON (up to 8,000 characters kept, `app.js:2551`), so it is cut garbage; the built-in tools return pictures through `{content, images}` (`chat.js` `runOne`). Fix: return `{content, images}` for `image` parts (vision models see them; others get "[image: mime, size]"). Test: fake tool returning a PNG part; assert the next request to a vision fake provider carries an `image_url`, and a non-vision one carries the placeholder.

**D-3 (M). The connector result limit of 8,000 characters cuts the middle (same cause as S-1) and nothing is saved.** `app.js:2551`. For connector results the full text is not stored even when W6-18 notes are on (`saveable` is only for workspace tools). Fix: the same "save to `.bunny/notes` and keep the path" for connector results that pass the secret check, only in Code mode with a workspace. Test: connector returns 30,000 characters; assert the model gets the head and a note path, and the note holds all of it.

## E. Plugins (`pluginImport.js`, `appTools.js:80-86`, `src/ui/customize.html`)

**P-1 (H). Most real plugin layouts import nothing.** The skill filter requires `skills/...`, a root `SKILL.md`, or exactly two path segments (`pluginImport.js:57`); a repository that keeps plugins under `plugins/<name>/skills/<skill>/SKILL.md` or `.claude/skills/...` gives "That repository has no skills" (`:93-95`) unless the URL has `/tree/<ref>/<path>`. Fix: accept any `**/skills/*/SKILL.md` and `.claude/skills`, and when a repository holds several plugins, list them and install the chosen one (or all, with names prefixed). Test: three fake trees (nested plugin, `.claude/skills`, multi-plugin repository); assert the skills are found.

**P-2 (H). A plugin's own commands and agents are skipped, and a skill that points to its scripts cannot run them.** `pluginImport.js:89-92` only counts `hooks/`, `commands/`, `agents/`, `scripts/` as "skipped". A `commands/*.md` is a prompt the person invokes; an `agents/*.md` is a helper's brief; a skill folder's `scripts/` are files its SKILL.md tells the model to run. Fix (smallest useful): import `commands/*.md` as skills named `/<plugin>:<command>`; import `agents/*.md` as named helper briefs usable by `run_subagent`; copy a skill's `scripts/` into the profile and give the skill's text the real path; hooks stay skipped and listed. Test: fake plugin with one command, one agent and a skill with `scripts/run.py`; assert the three appear in Customize and the skill text names an existing path.

**P-3 (H). Authenticated or legacy connectors in `.mcp.json` are added and then fail silently.** `pluginImport.js:83` keeps only `name` and `url`; a `headers` or `env`, or `"type": "sse"` (legacy SSE servers do not take POSTs at that address, which is all `mcp.js` speaks), is dropped. The connector is added as "enabled" and shows an error that the model never sees (L-2). Fix: skip `sse` servers and list them as skipped with the reason; when `headers` exist, add the connector switched off and ask the person for the token (R-1). Test: `.mcp.json` with one plain, one `sse`, one headers entry; assert import results are 1 on, 1 skipped, 1 off with a "needs sign-in" status.

**P-4 (M). Reinstall duplicates, and a plugin has no version or update.** `appTools.js:80-86` always adds; `record` stores no sha or version. Same cause as R-4. Fix as R-4, plus a "Update" action that re-reads the source and replaces the skills it owns. Test as R-4.

**P-5 (M). Plugins cannot be switched off as a whole, and cannot be uninstalled when listed twice.** `customize.html:264-266` hides "on/off" for plugins; the owner's W4-10 ("I am unable to uninstall these") is the uninstall side (`customize.html:289-291`). Fix: plugin on/off toggles its skills and connectors together; uninstall must also work for a record whose members are already gone or duplicated (ignore 404s, remove by record id). Test: install, toggle off (assert neither offered), uninstall twice (second is a no-op).

**P-6 (M, SEC). Installing a plugin is an edit in Manual but an unreviewed live instruction in Auto.** `install_plugin` is risk `edit` (`appTools.js:9-10`), so in Auto it runs unasked and the imported skill text (written by a stranger) is added to every later reply as system text, and its connectors are switched on. Not new, and the owner chose Auto's behaviour, but the audit asks that Bunny use plugins "properly": show the person what a plugin added (a card listing names, descriptions and urls) in every mode, and never auto-enable a connector that carries a url the person has not seen. Test: install in Auto; assert a card shows the names and urls, and the connectors start switched off until confirmed.

## F. Modes, helpers, providers

**M-1 (M). Plan mode hides connectors without telling the model.** `app.js:1895`. Covered by L-2.

**M-2 (M). The comment says connectors are "not in Chat mode", the code offers them in Chat.** `app.js:1836`. Decide and document: Chat offers them (recommended, the owner wants Bunny to use them). Test: with a connector on, a Chat-mode reply has its tools.

**H-1 (M). Helper rules for connectors.** A read-only helper gets only tools whose risk is `read` (`app.js:2037-2041`), so a connector tool without a `readOnlyHint` is never offered to a look-only helper even when it only reads (links to L-6); and helpers never see the skills index (S-5). Test: look-only helper with a connector that sets `readOnlyHint` has its tools; one without does not and the helper's report says so.

**PV-1 (H). A provider or model that refuses `tools` fails the whole reply.** Tools are sent to every provider whenever any exist (`chat.js:97`: `if (offerTools) body.tools = tools`); I found no code that retries without tools after a 400 such as "does not support tools", and no check of the model's real ability (the `abilities` list in `src/providers/catalog.js` is per provider, and custom providers are always `['coding','tool-use']`, `app.js:549`). A local model (Ollama, LM Studio) without tool support makes every chat fail while a connector, a skill's `read_skill` or `update_tasks` is on, because the app tools alone are always offered (`app.js:1845`). Fix: on a 400 that names tools, retry once without tools and tell the person once: "this model cannot use tools, skills or connectors; pick another model for that"; remember per model. Test: fake provider that answers 400 when `tools` is present; assert the reply completes as plain chat and the note appears; a second reply does not retry the failing request.

**PV-2 (M). Too many tools for a provider.** There is no cap on the number of tools sent (`app.js:1837-1899`); a connector with 90 tools plus the built-in ones passes the 128-tool limit of OpenAI-style APIs and also costs a large part of the context on every turn. Fix: when over a limit (default 100 or 20,000 characters of definitions), send only built-in tools plus a `use_connector` tool that lists a connector's tools and lets the model pick (deferred loading), or let the person choose which tools of a connector are on. Test: fake connector with 150 tools; assert the request has at most the limit and the model can reach any of the 150.

**PV-3 (L). `fake` mode answers text only.** `chat.js:48` (`fakeStream`), by design; but it means no automated test reaches connectors through a real chat. Fix: let the fake provider script tool calls (a header in the user message such as `[[call tool_name {json}]]`), which the tests above need.

# Order for Builder B

1. Test support first: PV-3 (scripted tool calls in the fake provider) and the fake MCP servers (HTTP with sessions, SSE, paging; stdio with instructions). Every test above depends on them.
2. The ones that stop a chat entirely: R-3, R-4, PV-1, PV-2.
3. The ones that make a kind "not work": S-1, S-2, D-1, R-2, R-1 (with W3-6), P-1, P-3, L-1.
4. The rest, M then L.
SEC items (R-1, L-4, P-6): Security reviews the design before the build.

# Which v0.1.8 rows I count as HIGH (for my review)

HIGH here means: touches credentials, a permission or window-only surface, the guard or the release path, or changes what runs without a click.

| Row | HIGH? | Why |
|---|---|---|
| W3-6 connector sign-in (`claude/builder-a-w3-6-final`, 1a1c364) | **HIGH** | tokens and OAuth, a secret store, new routes (`/api/connectors`, already in the window-only table) |
| W4-11 fixes R-1, L-4, P-6 | **HIGH** (those three) | credentials and an auto-enabled remote address; the rest of W4-11 is MEDIUM |
| W4-8 quick-ask bar | **HIGH** | a global shortcut, a new window with IPC in the main process, sends text to the model from outside the app window |
| G-1/K-1 follow-ups: the `heads/main` push spelling, allow-only `gh auth`, landing the kit | **HIGH** | the guard |
| W4-12 "Bunny asked" card cannot be answered | **HIGH to check** | the card posts to `/api/sessions/:id/question/:id`, which W5-7 made window-only (`windowOnly.js`); a broken answer path may be the window-only channel, not the card. Review before changing the route |
| W4-10 plugin uninstall | MEDIUM | deletes through window-only routes; P-5 shares the code |
| W4-9 fallback timeout setting | MEDIUM | a setting; keep it out of the window-only list only if it cannot widen what Bunny may do (it cannot) |
| W4-7 spell check and right-click menu | MEDIUM | Electron session settings; menu items must not run commands |
| W4-13 model picker | LOW to MEDIUM | UI only |
| README rewrite | LOW | docs |

# UNKNOWN (not checked)

- Connectors that Bunny builds in (Google Workspace, GitHub tools: `google.js`, `github.js`): not part of this audit's four kinds; I did not read them for the same three questions.
- `create_tool`/custom tools and `computer_*` in helpers and schedules: out of scope here.
- Whether W3-6 (1a1c364) already fixes R-1 and R-2: I did not read that branch.
- Behaviour against real servers (GitHub MCP, Notion, Linear, filesystem): nothing was run; R-2's claim is from the protocol, not from a failing server.
- The UI side of connectors beyond what I grepped (`customize.html`): empty-state texts, status display of an errored connector.
- Whether providers other than OpenAI-style (native Anthropic, Gemini) are reached only through their OpenAI-compatible endpoints: PV-1 and R-3's name rules assume yes; I saw `auth` headers in `chat.js` and `catalog.js`, not a second request format.
