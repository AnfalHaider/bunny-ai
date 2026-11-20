# AGENT-FLOW: why Bunny's own engine stops, errors or asks instead of acting

Tech Lead, 2026-11-20. Read-only diagnosis; nothing was built or run.

**Code read:** `claude/v0115-integration` at e2ec6ec6, whose server code is `main` 8889a54e plus OFFICE-MAKE. Line numbers are at e2ec6ec6 unless a file is named alone.

**The owner's words** (typed in the Chief of Staff's chat, 2026-11-20):

> "When I ask it to do something, it should know whether it has those tools or not. If not, it should be looking for those tools, downloading it. It just shouldn't give me an error. It should start working on the task and have the required tools like Claude or Codex does."

## Summary

Bunny's engine stops for six reasons. None of them is that a guard is wrong.

1. **The model can't see what it could have.**
   - The system text names three things to ask for: `code_mode`, `computer_use` and `new_tool`.
   - It never says which tools are on, which are off, why, or that the browser panel exists.
   - When a capability is off, its tools are simply missing, so the model concludes "I can't" (§1, §2).
2. **Installed tools don't arrive in the same reply.**
   - After `install_plugin` or `add_connector` and the "switch on" card, the reply goes on without the new connector's tools.
   - The person has to send another message (§4.3). This is the single biggest "it just errors" cause for the "find a tool and use it" flow the owner describes.
3. **Chat mode gets 6 steps and no more** (medium effort), and isn't extended.
   - A browser or research job in Chat runs out and answers half-done (§3.4).
4. **Plugin search is thin.**
   - It is an anonymous GitHub search, rate-limited to about 60 an hour, plus remote-only registry entries.
   - It has no curated list of known-good tools, and any connector that needs sign-in is listed as "Bunny cannot connect it yet" (§4.1).
5. **Ask is the default mode,** and in Ask every edit, every command and every computer click is its own card. Auto still stops:
   - for every install (two cards for a local connector);
   - for every mail send;
   - after any PC file was read (§3).
6. **No tool search.** Every tool is sent on every call. With connectors that can run past 100 tools, and weaker or "Auto"-routed models choose badly or refuse tools (PV-1).

The cheapest wins (F1 to F4) change no permission or security control.

## 1. Capabilities that are off by default, and what the model sees

| Capability | Default | Where it's decided | What the model sees when off |
|---|---|---|---|
| Files, commands, processes (Code mode) | Off until a folder is chosen; new chats are Chat mode unless asked (`app.js:2011`) | `workspace` at `app.js:2135` | Told, and asks: `request_capability` `code_mode`, which adds the tools **in the same reply** (`app.js:2526-2535`). A Code chat without a folder also gets a notice with the folder picker (`app.js:2303`). **Works.** |
| Browser panel | On only when the desktop window drives it (`body.browserControl`, `ui/chat.js:2544`) | `app.js:2339-2345` | **Nothing.** No tools, no system line, and no capability to ask for (there is no `browser` in `CAPABILITIES`, `agentTools.js:24-31`). On a device, or a page without `browserAct`, the model doesn't know a browser exists and says it can't browse. The browser tools are also refused for every device (`remoteAccess.js:221-224`). |
| Desktop control (computer use) | Off (`settings.aiComputerUse === true`, `app.js:2248`) | | The system text names `computer_use` (`app.js:2265`). The card adds the tools in the same reply (`app.js:2547-2552`). **Works**, but the yes is saved globally for every chat. |
| Build tools (`create_tool`) | Off (`customToolsEnabled === true`) | `app.js:2249` | Told to ask for `custom_tools` (`app.js:2277`). The card adds the tools in the same reply (`app.js:2554-2558`). **Works.** |
| Search this PC | Off (`pcSearchEnabled === true`, `pcService.js:50`) | `app.js:2299` | **Nothing in a chat:** no tools and no line, and `request_capability` has no `pc_search`. In the Quick ask bar the text says `[[NEEDS_BUNNY_WINDOW]]`. (A call to the tool while off returns "Search this PC is off. Turn it on in Settings, Capabilities.", `pcService.js:64`.) QA-PCOFF adds a card for the bar; at e2ec6ec6 it isn't merged here. |
| Web search, read a page | On | `appToolDefinitions`, `appTools.js:22-26` | Present. The search is a scrape of DuckDuckGo's HTML page (`appTools.js:62-80`), so a block or challenge page makes it fail with "The search answered NNN". There is no second provider. |
| Connectors (MCP) | The master switch is on (`connectorsEnabled !== false`); none are installed on a new profile | `app.js:2291` | Each one present is listed in a "Connectors:" line. One that needs sign-in shows a step with Sign in / Skip (`app.js:2366-2370`). |
| Skills, memory, helpers, artifacts, chat search | On | various | Present. |
| Google, GitHub | Only when signed in | `app.js:2325-2333` | Nothing when not signed in; no capability to ask for a sign-in. |
| Office files (OFFICE-MAKE) | On in Chat mode (no folder); in Code mode as workspace tools | `app.js:2313` | Present. |

**In one line:** three capabilities have a "please give me this" path (Code mode, computer use, build tools). The browser panel, PC search and the Google/GitHub sign-ins have none: the model sees nothing and falls back to "I can't".

## 2. Does the system text tell the model what exists?

- **What it says** (`honesty`, `app.js:2257-2277`):
  - "When you need something you do not have … call request_capability … (code_mode for files, commands and programs; computer_use to control this computer; new_tool for anything else)";
  - "For a job no tool can do, first look for a plugin or connector with search_plugins and offer to install it; if none fits, …".
- **What it doesn't say:**
  - which of Bunny's capabilities are on or off right now, and why (off in Settings, not on this device, no folder, not signed in);
  - that a browser panel exists and when it can be used. Its line is added only when it is usable (`app.js:2342`);
  - that PC search, Google or GitHub exist when off;
  - which connectors are installed but **switched off**, which needed sign-in, or which failed to start. Only working ones are listed in the "Connectors:" line;
  - that `create_tool`, `install_from_github` and a local connector each need the person's yes even in Auto. So the model is surprised by the card, or avoids the path.
- **`new_tool` only helps a little.** It approves "look for a plugin", and then returns the instruction to search (`app.js:2560-2561`). It adds no tool and grants nothing, so it is a card that costs a click without changing anything.

**Verdict:** the model is told how to ask for 3 of about 9 capability kinds, and never told the state of the others.

## 3. The permission flow in each mode

The order of a call (`app.js:2201-2208`, `:3131-3207`):

1. Plan mode;
2. the person's deny rule;
3. ask (a rule's ask, or `needsOk`);
4. allow.

`needsOk` (`app.js:2204-2208`) works like this:

| Risk | Ask (the default, `app.js:2150`) | Accept edits | Auto |
|---|---|---|---|
| read | runs | runs | runs |
| edit (write, edit, download, install_plugin, add_connector remote, Office files) | **card** | runs | runs |
| run (commands, unknown connector tools) | **card** | **card** | runs |
| build (computer clicks and typing, schedule, create_tool, local connector, install_from_github) | **card** | **card** | runs, **except** `asksInAuto` (`autoAsks.js:9-15`): create_tool, a schedule that may change things, a local connector, install_from_github |
| send (mail) | **card** | **card** | **card** |

### 3.1 How often Auto still stops, and why

| Stop in Auto | Why | Code |
|---|---|---|
| Every **install** of something new: the "Switch on what was just added?" card, after `install_plugin` or remote `add_connector` | P-6 (Security): what the model adds arrives OFF, and only the window's yes switches it on | `app.js:3225-3233` |
| A **local connector**: two cards (build, then switch on) | asksInAuto plus P-6 | `autoAsks.js:12`, `app.js:3199` |
| **`create_tool`** and **`install_from_github`**: a card each time | asksInAuto: code from the model or from the internet | `autoAsks.js:10,13` |
| **Sending mail**: every time | it speaks for the person | `app.js:2205` |
| **After any PC file was read** in this chat: every tool except reads needs a click | SEARCH-PC taint (Security) | `app.js:3092` |
| A person's **ask rule** | their rule | `app.js:3207` |
| **Limits**: about 1.5M tokens, the same step 3 times, no new step in 25 | the cards in `onLimit` | `app.js:3436-3450` |
| A Code reply's **step cap** (`autoContinueSteps` 500, 120 min) | Settings | `app.js:3423-3429` |

Each of these has a reason Security signed. None is a bug. They add up to "Auto still asks a lot" mainly in the install path. For ordinary coding in Auto, only mail, PC taint and the limits stop it.

### 3.2 Ask and Accept edits

- **Ask, the default:** every edit and every command is its own card, and the yes is for that one call. There is no "allow this kind for this chat". The only way to stop repeat cards is a permanent rule in Settings, and rule syntax beyond plain patterns is PERM-REFINE, which is HIGH and with the owner.
- **Computer use outside Auto** is a card per click, per keypress and per screenshot round. That is unusable for a real task.

### 3.3 Engines

- Claude Code and Codex chats go through the bridge and the floor (`engines/bridge.js`).
- In Bunny-rules mode, Bunny's cards apply. In engine-rules mode, the engine's own rules apply, inside the floor.
- They aren't part of the "stuck" picture, and they are already the path that behaves most like the owner wants.

### 3.4 Steps

- `EFFORT` (`app.js:3269-3274`):
  - **Chat mode gets 3, 6, 10 or 16 tool rounds** (low, medium, high, max);
  - Code mode gets 12, 30, 45 or 70, and Code is **extended** (`extendRounds`, `app.js:3423-3429`) up to the Settings cap.
- **Chat is never extended:** `extendRounds` returns false when `workMode !== 'code' && !workspace`. At medium effort, a Chat job that does web search, browser open, read, click, read, then needs more stops after 6 steps. `chat.js:271` then asks for a final answer from what it has.

## 4. Search and install: where it ends in an error instead of a card

1. **`search_plugins`** (`pluginImport.js:172-204`):
   - It is an **anonymous** GitHub search API call. Without a token, GitHub allows about 10 searches a minute and 60 calls an hour per address, so a busy hour gives "GitHub search failed: …" as text.
   - The query is decorated with `skill OR plugin OR mcp`, sorted by stars. That favours big lists ("awesome-…") over the one tool needed.
   - The MCP registry part lists only servers with a **remote** address; local npm and PyPI packages are dropped. Any that needs a header is listed as "(needs sign-in, Bunny cannot connect it yet)", which tells the model to give up on it.
   - There is **no curated list** of known-good tools for common jobs (browser automation, PDF, spreadsheets, a given SaaS).
   - The search doesn't use the person's GitHub sign-in even when it is there (`accounts.githubToken()` is read at `app.js:2293` but not passed in).
2. **`install_plugin` / `add_connector`:**
   - These are `'edit'` (`appTools.js:13`), so Ask asks first, then the switch-on card asks again: two cards in Ask, one in Auto.
   - A text that is too long (over 1,800 characters) is never offered for switch-on: "it stays switched OFF; the person can … switch it on in Settings" (`app.js:3228`). That is a dead end with no card.
3. **After the yes, the tools are not there.**
   - `appTools.switchOn(added)` switches the connector or skill on, and the model is told "it is now switched on" (`app.js:3231`).
   - But `servers`, `toolIndex` and `toolDefinitions` were built once at the start of the reply (`app.js:2291`, `:2347-2385`), and nothing after `switchOn` adds the new connector's tools.
   - Compare `request_capability`, which **does** push tools mid-reply (`app.js:2530`, `:2544`, `:2551`, `:2557`).
   - So the model either stops ("send me another message to use it") or calls a tool it doesn't have, which fails. This matches the owner's "it just errors".
4. **Sign-in.** A connector that needs OAuth shows the sign-in step only when the next reply starts it (`app.js:2366-2370`). The flow is: install, then switch on, then another message, then sign in, then another message.
5. **`create_tool`** is off by default, and the system text tells the model to ask for `custom_tools` first. That is one card to turn it on, and then one card per tool, even in Auto.
6. **Devices.** `install_plugin`, `add_connector`, `install_from_github`, `create_tool` and the browser and computer tools are all refused for a device (`remoteAccess.js:221-225`), and the tools are filtered out silently (`app.js:2624`). On a device the model just doesn't have them, and doesn't know why.

## 5. What Claude Code and Codex do differently

This is from their public documentation as of my training; the Researcher should confirm current behaviour before any build. The point of each row is the *pattern*, not the exact product detail.

| Pattern | Claude Code | Codex (CLI and app) | Bunny today |
|---|---|---|---|
| **Tool search / deferred tools** | Connector (MCP) tools beyond a threshold aren't all sent. The model gets a search tool and loads only the tool definitions it needs (deferred tools). | A smaller fixed core of tools; MCP tools as configured. | Every tool on every call; a connector's tools are cut at its own cap, and the rest are never offered. |
| **Knowing what is off** | Settings and tool lists are visible to the model as a deferred list (names known, schemas loaded on demand). | Fixed core. | Off means invisible (§1). |
| **Auto with judgement** | Modes: default (ask), accept edits, plan, bypass; and an auto mode where a classifier reviews each action and blocks the risky ones, instead of a fixed list. | Approval policies (ask on request, on failure, never) with a sandbox. | A fixed risk table per tool (`needsOk`), with no judgement per action. |
| **One approval per kind** | "Yes, and don't ask again for <command prefix / this tool> in this project" writes an allow rule from the card. | Approve for this session. | Each card approves one call; rules are made only in Settings. |
| **Sandbox** | Bash sandboxing with file and network limits on macOS and Linux. | A workspace-write sandbox, network off by default. | No sandbox on Windows; a guard rail only (README). Windows command confinement is research-first and with the owner. |
| **Installing tools mid-task** | Plugins and MCP can be added, and the tools are available after a reload or a restart of the session. | Similar. | Added off, a card, and only usable next message (§4.3). |

The two biggest differences in practice:

1. **The model always knows what tools exist,** even when they aren't loaded.
2. **One yes covers a kind of action.**

Bunny's guards are as strong as or stronger than theirs. The gap is in telling the model, and in the number of yeses.

## 6. Fixes, ranked by impact against risk

**HIGH** means it changes a permission, a security control or a Security-signed rule, so it needs the owner's go (AGENTS.md risk levels). The others are LOW or MEDIUM.

| # | Fix | Impact | Risk | Level |
|---|---|---|---|---|
| **F1** | **Load what was just switched on into the same reply.** After `switchOn`, re-read that one server's tools (the `mcpListTools` path already used at reply start). Add them to `toolIndex` and `toolDefinitions`, as `request_capability` does, and tell the model their names. Start the sign-in step at once if the connector needs it. | Very high: closes the "installed, now send another message" dead end | Low: no new permission. The switch-on card is unchanged. | MEDIUM |
| **F2** | **A capability map in the system text.** Fixed wording, built from the real state: <br>• each capability: on, off in Settings, not on this device, no folder, or not signed in; <br>• how to get it (the `request_capability` name or the person's step); <br>• which connectors are installed but off, need sign-in, or failed. <br>No new tools. | High: the model stops saying "I can't" and asks instead | Low: text only, fixed wording, no settings exposed beyond names. | MEDIUM |
| **F3** | **Chat mode gets extended steps like Code** (the same `extendRounds` up to the Settings cap). Chat's base steps go to the Code numbers, or at least medium 12. | High for browser and research jobs | Low: the existing limit cards still stop runaway jobs. | LOW |
| **F4** | **Better plugin search.** <br>• Use the person's GitHub token when signed in (no anonymous rate limit). <br>• List registry **packages** (npm and PyPI) as local-connector candidates, not only remotes. <br>• Stop saying "Bunny cannot connect it yet" for header sign-ins Bunny now supports. <br>• Add a short curated, Security-reviewed list of known-good tools for common jobs, shown first. <br>Any install still goes through today's cards. | High | Medium: the curated list is a trust decision, so Security reviews each entry. Installing still asks. | MEDIUM |
| **F5** | **Missing paths become cards, not silence:** <br>• `request_capability` gains `browser_panel` (tells the person to open the panel or use the desktop app; on a device it says why not) and `sign_in` (Google or GitHub, the existing sign-in flow); <br>• the 1,800-character dead end becomes a card with "open it in Customize". | Medium | Low | MEDIUM |
| **F6** | **A second web search provider** when the DuckDuckGo page fails (a search API with the person's key, or the browser panel if it is open). | Medium | Low: a new outbound host; Security looks at it. | MEDIUM |
| **F7** | **Tool search / deferred tools.** Offer the core tools plus `find_tools(query)`. Connector tools (and rarely used Bunny tools) are listed by name and loaded on demand within the reply. | Medium-high on weak models and many connectors | Medium: the server check of each call already refuses a tool that was never offered (`app.js:3084`), and that must stay true for deferred tools. | MEDIUM |
| **F8** | **`request_capability` `pc_search`:** the card turns Search this PC on (window-only, as now). | Medium | It switches on a privacy control from inside a chat, even with the person's click. | **HIGH** |
| **F9** | **"Allow this kind for this chat" on a card:** e.g. this command prefix, edits under this folder, this connector tool, computer clicks for this task. It is session-scoped; it is never added to Settings rules unless the person ticks it. | Very high for Ask and computer use | It changes the permission model (it overlaps PERM-REFINE). | **HIGH** |
| **F10** | **One card for install and switch-on** (Ask asks once, not twice; a local connector asks once in Auto). | Medium | It changes P-6 and asksInAuto, both Security-signed. | **HIGH** |
| **F11** | **Auto with a judge:** a cheap model (or rules) reviews each Auto action. It can relax the fixed asksInAuto list for actions it finds safe, and stop risky ones that the table lets through today (e.g. a command sending `.env` out). | High | It changes a security control, and a classifier can be wrong both ways. | **HIGH** |
| **F12** | **The default mode for new Code chats becomes Auto** (or Accept edits). | High on feel | It changes a permission default. | **HIGH** |
| **F13** | **Windows command confinement** (AppContainer or a restricted token) for Auto. This is what would make F11 and F12 safe to do boldly. | High, long term | Research first (already on the "Needs the owner" list). | **HIGH** |

### Suggested order

1. **F1 to F4 as one v0.1.16 batch.** No permission changes; Security reviews F4's list and F2's wording.
2. **Then F5 to F7.**
3. **F8 to F13 go to the owner,** one question at a time (O12), with F9 first: it is the largest change in how Bunny feels to use.
4. **Meanwhile, the owner can already get "Claude Code-like" behaviour** by running a chat on the Claude Code or Codex engine, with Bunny's floor still in force.

## 7. Evidence

- Code at e2ec6ec6, read with `git archive e2ec6ec6 src`. These are the line references above. Nothing was run.
- Not checked: the Electron side that decides `browserAct` (`electron/`), beyond `ui/chat.js:2544`. And the current Claude Code and Codex behaviour in §5 is from documentation, not tried.
