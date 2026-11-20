# AGENT-FLOW F5, F6, F7

Tech Lead, 2026-11-20. v0.1.15. These come from `docs/plans/AGENT-FLOW-diagnosis.md` §6 (de4553b8). None of the three changes a permission.

| Item | What | Level |
|---|---|---|
| F5 | Cards for the missing capabilities | MEDIUM |
| F6 | A second web-search provider | MEDIUM: a new outbound host, which Security looks at |
| F7 | Deferred tools with a tool search | MEDIUM |

- **Builder B has F1 to F3, and Builder C has F4.** F5 builds on F2's capability map (the same state object), so F5 lands after F2.
- **Code references** are at e2ec6ec6.

---

## F5: cards for the missing capabilities

### Today

- `request_capability` knows six capabilities (`agentTools.js:24-31`).
- **Missing paths.** The browser panel, the Google and GitHub sign-ins, and a connector that needs sign-in have no path at all.
- **A dead end.** A plugin whose description is over 1,800 characters stays off, with text only (`app.js:3228`).

### Change

1. **New capabilities** in `CAPABILITIES`. Each gets the same card as today (`askCapability`), answered only in Bunny's window.

   | Capability | Card title | On yes | When it isn't possible |
   |---|---|---|---|
   | `browser_panel` | "Use the browser beside the chat" | The window opens the browser panel. The browser tools are pushed into this reply (`toolDefinitions.push(...browserToolDefinitions(...))`, as `code_mode` does) together with the browser system line. | **From a device, or a window without `bunnyDesktop.browserAct`:** no card. The fixed answer to the model is: "The browser panel is only in Bunny's window on the PC. Use web_search and read_url here, or tell the person to continue in Bunny's window." |
   | `sign_in` with `{ service: 'google' \| 'github' }` | "Sign in to Google" or "Sign in to GitHub" | The existing sign-in flow (`accounts`) starts from the card. When it finishes, the service's tools are pushed into this reply with their system line (`app.js:2325-2333`). | **Google with no client set up** (`googleClientId` empty): the card says so, with a button to Settings → Accounts, and the model is told "Google isn't set up in Bunny yet". |
   | `connector_sign_in` with `{ connector: <name> }` | "Sign in to <connector>" | The existing connector sign-in (`connectorSignIn`). After it, that connector's tools are listed and pushed into this reply (F1's path). | |

2. **The 1,800-character dead end becomes a card:** "<name> is installed and off. Its description is too long to show here." The button **Open in Customize** goes to that item.
   - Nothing is switched on from the card. Switching on stays in Customize, as P-6 says.
   - The model is told: "It stays off until the person switches it on in Customize."
3. **Silence becomes words.** Each of these gives the model a fixed sentence it can act on, never only a missing tool:
   - **A tool that a device can't use** (`remoteToolBlocked`): one system line per reply that names the device-blocked kinds ("On this device you can't use: the browser, desktop control, installing tools, scheduling"). Today they are filtered out silently (`app.js:2624`).
   - **Tools refused by the model** (PV-1): the existing step line stays, plus a system line on the next turn: "Your tools were turned off for this model."
4. **The capability map (F2)** lists each new capability with its state, so the model knows the name to ask for.
5. **Helpers never get these cards** (`HELPER_NEVER`, `app.js:2577`). The new names are added there.

### Tests

**Unit** (`test/capabilities-f5.test.js`, stand-in model, invented profile):

1. **`browser_panel`:**
   - in a window with the desktop bridge stand-in, yes adds the browser tools in the same reply, and the next call to `browser_open` runs;
   - from a device, or without the bridge, there is no card and the fixed sentence comes back.
2. **`sign_in`:**
   - GitHub with the stand-in device flow: yes, then signed in, then the `github_` tools are in the same reply;
   - Google with no client: the card says so, and nothing starts.
3. **`connector_sign_in`:** the stand-in OAuth connector's tools appear in the same reply after sign-in.
4. **The over-long plugin:** the card with Open in Customize; nothing is switched on.
5. **A device:** the system line names the blocked kinds, and a blocked tool is never offered.
6. **Helpers:** every new capability is in `HELPER_NEVER`.
7. **No:** each "no" answer gives "The person said no…" and the capability is not asked again in that reply.

**End-to-end:**

- In the desktop build, the stand-in model asks for `browser_panel`, the card shows, Yes opens the panel, and the model's next step opens a page.
- **Pictures:** each card, desktop and phone, both themes.

**QA functional check:**

1. On an invented profile with GitHub signed out, ask "list my open GitHub issues". The sign-in card appears; after signing in with a test account, the list comes in the same reply.
2. From a phone device, ask to open a web page. Bunny says the browser is only on the PC, and answers with `read_url`.

---

## F6: a second web-search provider

### Today

- `webSearch` scrapes `html.duckduckgo.com` (`appTools.js:62-80`).
- A block page, a captcha, a 202 or a layout change gives "The search answered NNN" or no results. There is no second way.

### Change

1. **Providers, tried in order,** until one returns at least one result. Each has a 15 s limit.
   - **(a) Brave Search API**, when the person has added a key (Settings → Web search → "Brave Search key", stored in the DPAPI secrets as `search:brave`). The host is `api.search.brave.com`.
   - **(b) DuckDuckGo HTML**, as today.
   - **(c) The browser panel**, when it is usable in this reply (in Bunny's window): `browser_open` of `https://duckduckgo.com/?q=…` and `browser_read`, shown to the person as a step.
   - **With a key the order is (a), then (b). Without a key it is (b) only.** (c) is tried only after both fail, and only in a window.
2. **Why Brave.** It has an official, documented search API with a free tier for low volume, a plain JSON answer, and no scraping. **The Researcher confirms the current terms and free allowance before build.**
   - The design takes any key-based provider. One `searchProviders` table holds the host, the request and the result mapping, so a second keyed provider (Tavily, Bing) is one entry, if Security agrees later.
3. **The result shape is unchanged:** titles, links, snippets, one line each, cleaned as today. It also says which provider answered ("via Brave"), so a reply's sources are honest.
4. **On total failure,** the tool result says each provider's reason in one line, and adds "Try again in a minute, or add a Brave Search key in Settings, Web search". Never just an error.
5. **Quick ask's own search** (QV-1) uses the same order.
6. **Security, new outbound host:**
   - `api.search.brave.com` is reached only with the person's key, and only for `web_search`;
   - the key goes in a header (`X-Subscription-Token`) and is never logged;
   - it is window-only to set (added to `WINDOW_ONLY_SETTING_KEYS`).

### Tests

**Unit** (`test/web-search-f6.test.js`, all fetches stubbed, no network; `test/support/no-network.mjs` stays on):

1. **With a key**, Brave answers and the result says "via Brave". With no key, Brave is never called.
2. **Brave fails** (401, 429, timeout): DuckDuckGo is tried, and the result says why Brave failed.
3. **DuckDuckGo fails** with a 202 challenge page or zero matches. In a window with the browser stand-in, the panel path runs; otherwise, the failure text names each reason and the hint.
4. **The key:** it is never in a log line, a step result or an error text (searched for in all output), and a device's `PATCH` of the key gets 403.
5. **Quick ask's search** uses the same order.

**End-to-end:** the stand-in upstream asks for `web_search`, and DuckDuckGo is stubbed to fail. With a stub Brave key, the step shows "via Brave".

**QA functional check:**

1. With no key, ask "weather in Islamabad today": the answer has sources.
2. Add an invented-but-shaped key: the step shows the provider, and the failure text is clear (the key is refused).
3. Remove the key: the answer still comes, through DuckDuckGo.

---

## F7: deferred tools with a tool search

### Today

- Every tool is sent on every call.
- Connector tools are capped (`capTools`, `mcp.js:307`: 100 tools or 20,000 characters), and the rest are never offered.
- Weak or routed models choose badly with long lists, or refuse tools (PV-1).

### Change

1. **The core set is always sent.** It holds:
   - `request_capability`, `ask_user`, `update_tasks`;
   - the mode's file and command tools;
   - `web_search`, `read_url`;
   - the artifact tools and Office tools;
   - memory;
   - `find_tools`.
2. **Deferred tools:** every connector tool, the `gmail_`, `calendar_`, `drive_` and `github_` tools, `search_chats`, the skills and plugin tools, and the built tools (`my_*`).
   - Their **names** are known to the model: one system line lists them grouped by source ("GitHub: github_list_issues, github_create_issue, …; Notion (connector): …"), cut at 3,000 characters with "and N more: use find_tools".
   - Their **schemas** are not sent until loaded.
3. **When to defer.** Only when the full list would be over **40 tools or 30,000 characters of definitions**. Below that, everything is sent as today, so small setups behave exactly as now.
4. **`find_tools({ query?: string, names?: string[] })`:**
   - It returns up to **15** matching tools (name, source, one-line description).
   - It **adds their definitions to `toolDefinitions` for the rest of this reply.** The next model call carries them, the same mechanism as `request_capability`.
   - Matching is on the name and description, case-insensitive, with words ANDed. `names` loads exact names.
   - Its risk is `read`. It is allowed in Plan mode, and its describe line is "Look for tools: <query>".
5. **The server check stays the truth.** A call for a deferred tool that **was not loaded** in this reply is refused, like any tool that wasn't offered (`app.js:3084`), with: "Load it first with find_tools(names: ['<name>'])."
   - So "a tool that was not offered never runs" still holds. Loading is offering.
6. **Risk doesn't change.** A loaded tool keeps its own risk, card and rules. Loading a `send` tool doesn't send anything.
7. **Device and Plan filters apply before listing.** A device never sees the names of tools it can't use, and Plan mode lists only read tools.
8. **Next reply.** The loaded set starts empty each reply; the system line still names everything. **Builder measures** whether keeping the loaded set across a chat saves tokens, and records it; v1 resets.

### Tests

**Unit** (`test/deferred-tools-f7.test.js`):

1. **The threshold:** 39 tools means no deferral and no `find_tools`; 60 tools means the core set plus `find_tools` plus the names line.
2. **Loading:**
   - `find_tools({ query: 'issue' })` returns the `github_*issue*` tools;
   - the next round's tool list holds their schemas;
   - `names` loads exact names, and unknown names are named in the result.
3. **The server check:**
   - a call to `github_create_issue` before loading is refused with the hint, and nothing runs;
   - after loading, it runs through its normal card.
4. **Filters:**
   - Plan mode lists only read tools and `find_tools` never loads a write tool there;
   - a device's names line never holds a device-blocked tool.
5. **Caps:** the names line is cut at 3,000 characters with "and N more"; `find_tools` returns 15 at most.
6. **Risk unchanged:** a loaded `gmail_send` still asks in every mode.

**End-to-end:** with 3 stand-in connectors of 30 tools each, the stand-in model calls `find_tools`, then one connector tool. The step lines show "Look for tools" and then the tool, and the card appears for a write tool.

**QA functional check:**

1. On an invented profile with several connectors, ask a task that needs one connector tool. Bunny finds and uses it with no error.
2. Ask the same with the connectors off. The capability map says so, and Bunny offers to switch them on (F2, F5).
