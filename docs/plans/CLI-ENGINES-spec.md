# CLI-ENGINES: architecture spec (revision 9, for the build)

Tech Lead, 2026-11-19. Revision 9 replaces 630629b (revision 8) and every earlier revision. Earlier revisions are in this file's git history.

Revision 9 is a clean rewrite for Builder C to build from. **v0.1.14 ships two engines: Claude Code and Codex CLI, both in full mode.** Aider and Cline are in §11, "Later". The adapter is simplified to what those two need, with the interface left open so a later engine can be added (§1.2).

Risk: **HIGH**: a new execution engine, a permission bridge, third-party code downloaded and run, and a local model endpoint. Security's requirements are binding (§3.6), and Security signs each engine (CE-9).

## The owner's words (typed in the Chief of Staff's chat)

1. "Yes, lets go with claude and codex , also the cli's should be bundled in the application, with the option to update them from within the application also." (2026-11-18)
2. "Claude Code, Codex CLI, Aider, Cline , add all these."
3. "my idea is that none work on accounts, since we are using custom models and anyway, so the CLI's should not require linking to an account."
4. "ok build all these, i will sign in with anthroic account when required, but now i think we will need this option in settings also, when we enable a CLI, we need to have option infront of all to sign in with accounts or operate locally."
5. Asked how to offer engines that can't check with Bunny first: "restricted mode".
6. "yes run the real test, codex approved, leave cline out of 0.1.14" (ca501c9): R23 is accepted for Codex, and Cline is out.
7. **"lets remove cline and other for now, just focus on codex and claude."** (2026-11-19, relayed by the Chief of Staff.) This is the scope of v0.1.14.

**What follows:**
- **Two engines:** Claude Code and Codex CLI, in full mode. Restricted mode stays as each engine's fallback (§0.2).
- **Each engine has an auth mode** (word 4, §7):
  - **account**: the vendor's own sign-in, run visibly by the owner;
  - **local**: Bunny's endpoint and Bunny's models.
  - Claude Code in local mode carries a plain note (§7.2).
- **Downloaded on click, never inside the installer.** Each engine is several hundred MB. Engines are stored per version, and updated and rolled back from Settings. This is the owner's "update them from within the application"; carrying them in the installer would make it several times larger.
- **The Engines page lists exactly two engines**, Claude Code and Codex CLI, with no Aider or Cline row.

**Sources:**
- Researcher: e462903 (F1 is Codex, F2 is Claude Code) and 0e71850 (report §7).
- Spikes, by Builder C, under `docs/spikes/cli-engines/`:
  - **S1** (Claude Code 2.1.311): e1e568f, with addenda c532469, 7b1f864, 2a92e8f and 4b74686;
  - **S2** (Codex 0.170.0): 401bd92;
  - **S3** (Cline): 767c4ea.
- Security, in `docs/security/2026-11-18-cli-engines-requirements.md`: CE-1 to CE-9 (13478ca), and the rulings 8369e8e, 70093c7 and 2fd5b2b.

Code references are to 43ced06 (v0.1.13).

---

## 0. The musts

| # | Must |
|---|---|
| M1 | Bunny's own engine stays the default. Choosing an engine is a window-only setting. |
| M2 | Every action an engine takes on the PC is decided by Bunny **before it reaches the person's folder**: a command, a file write, a read outside the folder, a fetch, an MCP call. The same rules and modes apply as for Bunny's own engine. |
| M3 | An engine never sees one of Bunny's provider keys. In local mode it sees only a per-run token for Bunny's local endpoint. In account mode Bunny never reads, stores or forwards the vendor's credential (§7). |
| M4 | An engine runs with its own isolated config home inside Bunny's data folder, one per engine and per mode (§4.2, §7.3). It never reads the person's own `~/.claude` or `~/.codex`, or any global or project MCP servers, hooks, rules or settings. |
| M5 | Local mode needs no account and nothing paid. In either mode there is no telemetry, and no self-update that phones home. Updates come only through Bunny's pinned flow (§4). |
| M6 | Fail closed. If the approval channel is unreachable, an event can't be parsed, or a run ends oddly, the run stops and says why. Nothing goes on unjudged. |
| M7 | Nothing an engine changes is left without a way back. Checkpoints and "Undo changes" work for an engine chat as they do for Bunny's own engine. |

### 0.1 The verdict

| Engine | Mode | Basis |
|---|---|---|
| **Claude Code** 2.1.311 | **Full mode** with the five layers CE-1.7 to CE-1.11 (§3.2) | S1. The `PreToolUse` hook sees every tool, including MCP, `Agent` and subagents' own calls, and a deny stops it. Bunny's settings source alone loads. A read outside the folder hits the hook. **The hook alone fails open** (a crash, exit 1, garbage, a timeout, a kill, a missing runtime), which is why the second layer is required. Security 8369e8e and 70093c7. **The accepted residual:** when the hook dies, Claude Code can still read workspace files that no Bunny rule covers, until the watchdog stops the run. |
| **Codex CLI** 0.170.0 | **Full mode** with the six layers CE-1.12 to CE-1.17 (§3.2) | S2. `approval_policy = "untrusted"` sends a request for **every** command and **every** patch, and a decline stops each. `on-request` and `granular` ask for nothing once the sandbox is on. Security 70093c7. **The accepted residual (R23):** a command Bunny accepts can read files outside the folder, as Bunny's own `run_command` can. The owner accepted it: "codex approved". |

**The rule throughout:** if a layer is missing at run time, or the watchdog stops a run, that engine runs in **restricted mode** (§0.2). Bunny never weakens a must to fit a CLI.

### 0.2 Restricted mode: each engine's fallback (owner's word 5)

Restricted mode is used when a full-mode layer is missing, or when the watchdog (CE-1.10, CE-1.17) has stopped a run and the person chooses to go on restricted.

1. **A confined copy.** The engine works in a staged copy of the workspace (§3.3). The copy leaves out:
   - every hidden and denied path;
   - the data folder and every engine home;
   - `.git`, `.claude` and `.codex`;
   - every symlink, junction and reparse point.
2. **No commands.** The engine's own command tools are off, and so are web, MCP and subagents:

   | Engine | How | Evidence |
   |---|---|---|
   | Claude Code | `--restricted`, which removes Bash, PowerShell, Monitor, WebFetch and Workflow and confines file tools to the working folders, **plus** the same `--disallowedTools` as full mode, and **no MCP config**. | S1 addenda 2 and 3: the canary stays unread, a write outside the folder is refused, and only `conhost.exe` starts. `--restricted` still allows Write and Edit, and `Agent` unless it is disallowed. |
   | Codex CLI | `features.shell_tool=false`, `features.unified_exec=false` and `features.view_image=false`, plus everything in CE-1.14. That leaves `apply_patch`, `request_user_input` and `tool_search`. | S2 `i-all-off-view-image`: the canary stays closed, and every patch asks, including patches outside the folder, which are declined. |
3. **Bunny reviews the diff.** When the turn ends, Bunny judges every changed, added or deleted path with the rules for its own `write_file` and `edit_file` (§3.1, CE-2). Only what is allowed is written, through Bunny's write path and checkpoints. Ask rules give one card listing the files. Plan mode keeps nothing.
4. **It is said plainly.** The chat and Settings say the engine is restricted. Design words it, for example "Restricted: edits files in a copy; Bunny checks each change before it's kept; runs no commands."

**Not in v0.1.14:**
- Aider and Cline (§11);
- Cursor CLI;
- Chat-mode chats on an engine;
- Bunny's own tools offered to an engine (memory, artifacts, browser, connectors, helpers).

---

## 1. The adapter

### 1.1 Files

`src/server/engines/`:
- `index.js`: the registry;
- `claude-code.js` and `codex.js`: one adapter each;
- `events.js`: the event union;
- `bridge.js`: approvals, including the hook script's server side (§3);
- `hook.mjs`: the fixed hook script, copied into the isolated home at each run (CE-1.7);
- `staging.js`: restricted mode's staged copy (§3.3);
- `endpoint.js`, plus `translate/responses.js` and `translate/messages.js`: the local endpoint (§2);
- `store.js`: downloads, versions, rollback (§4);
- `pins.json`: tested versions (§4.3);
- `fake-engine.mjs`: a scripted stand-in for tests (§5).

### 1.2 What an adapter declares

Each adapter declares its differences as data. Everything else in Bunny reads the declaration, never the engine's name.

```js
export const profile = {
  id: 'claude-code' | 'codex',
  label: 'Claude Code' | 'Codex CLI',
  transport: 'jsonl' | 'json-rpc',          // how events arrive (1.3)
  wire: 'messages' | 'responses',           // what it sends to the local endpoint (2.1), local mode only
  auth: ['account', 'local'],               // both engines support both (7)
  defaultAuth: 'account' | 'local',         // Claude Code: account; Codex: local
  resume: true,                             // both can resume their own session (1.5)
  expectedTools: { full: [...], restricted: [...] },  // the tool-list check (CE-1.16, and §3.2 for Claude Code)
};
```

- **Left open for later**, so an engine can be added without changing the shared parts: `transport` and `wire` are unions that a new value can extend, and `approvals` is not a field, because both v0.1.14 engines are per-call with restricted as the fallback.
- **Removed in revision 9** because only Aider needed them: the `text` transport, the `python` and `node` runtimes, the `chat` wire with its Chat Completions passthrough, and the "staged only" approval kind. §11 says what adding them back would take.

| Engine | transport | wire (local mode) | auth (default) | Runtime |
|---|---|---|---|---|
| Claude Code | `jsonl`: stream-json out, stream-json in on stdin | `messages` | account | native `claude.exe` |
| Codex CLI | `json-rpc`: `codex app-server` over stdio | `responses` | local | native `codex-x86_64-pc-windows-msvc.exe` and its helpers |

### 1.3 The run and its events

```js
start({ runId, cwd, prompt, resume, mode, restricted, auth, endpoint, approve, home, env, signal })
  → { events /* AsyncIterable<EngineEvent> */, stop() }
```

**Arguments:**
- `cwd` is the workspace root, or the staged copy in restricted mode (§3.3).
- `approve(request)` resolves to `{ allow, reason }` (§3.1).
- `env` is `safeEnv()` plus only what the adapter names (M3, M4, CE-3.4).
- **`prompt` never goes on the command line** (CE-8.1). It goes in Claude Code's stream-json input on stdin, or in Codex's `turn/start`.

**How the CLI is run:**
- It starts through `safeExec`: an absolute path, `windowsHide`, and no inherited handles but the pipes.
- On `stop()`, a timeout, an abort or Bunny quitting, the whole process tree is killed with `taskkillPath() /T /F` (CE-8.2). No engine process outlives its run, and Bunny checks for stragglers on quit.
- A run that prints nothing for the wait limit (`waitLimits`) ends and says so.

**The event union, the same for both engines:**

| EngineEvent | Bunny's SSE event (`send`, app.js ~1960) | Saved in the chat |
|---|---|---|
| `text {delta}` | `delta` | the assistant message |
| `thinking {delta}` | `thinking` | as today |
| `tool-start {callId, name, input}` | `tool {status: 'running'}` | a step, opened |
| `tool-end {callId, ok, output}` | `tool {status: 'done' \| 'failed', result}` | a step through `keepForModel`: `result` up to 1 200 characters; `modelResult` up to 8 000, never secret-like, never incognito |
| `approval {requestId, name, input}` | decided by the bridge; only an Ask reaches `send('permission')` through `askPermission` | the answer, as a step note |
| `question {requestId, text, options}` | `question`, the existing card. Codex: `request_user_input`. Claude Code: `AskUserQuestion` is not offered (it's not in the expected tool list), so no question event comes from it | as today |
| `edit {path}` | the Changes pane (`changesFor`) and checkpoints | as today |
| `usage {input, output}` | none; added to `usage.js` against the real provider (§2.3), or as "billed by <vendor>" in account mode | |
| `session {engineSessionId}` | none | `session.engine = { id, auth, sessionId, version }` |
| `done {stopReason}`, `error {code, message}` | `done`, `error` | |

**Reading each transport:**
- **jsonl (Claude Code).**
  - One JSON object per line, at most 1 MB a line. A line that isn't valid JSON, or fails validation, ends the run (M6).
  - The reader holds the CE-1.10 watchdog map: tool_use id → bridge request seen.
  - At `system/init` it runs the tool-list check.
- **json-rpc (Codex).**
  - The handshake is `initialize` / `initialized`, **without** `capabilities.experimentalApi`.
  - Then `thread/start`, with `cwd`, `approvalPolicy: "untrusted"`, the sandbox, `ephemeral: true` and the pinned model name. At this point the reader runs the tool-list check.
  - Then `turn/start`. Notifications mapped: `item/started`, `item/completed`, `item/agentMessage/delta` and `turn/*`.
  - Approvals are answered `accept` or `decline` from `approve()`, or `cancel` on Stop. **Never `acceptForSession`.** `item/permissions/requestApproval` and the legacy `applyPatchApproval` and `execCommandApproval` are always declined.
  - Stop sends `turn/interrupt`, then the tree kill.
  - The method names come from S2's pinned schema (`docs/spikes/cli-engines/s2/schema/`), kept beside the pin. An unknown method or notification ends the run.

**Tool names.** Each adapter maps its CLI's tools onto Bunny's step names: `run_command`, `read_file`, `write_file`, `edit_file`, `search_files` and `find_files`. The CLI's own name rides along as `engineTool`. An unknown tool is judged as `run`.

| Claude Code | Codex | Bunny step |
|---|---|---|
| Bash, PowerShell | `exec_command`, `write_stdin` (`commandExecution`) | `run_command` |
| Read | | `read_file` |
| Write | `apply_patch` adding a file (`fileChange`) | `write_file` |
| Edit, NotebookEdit | `apply_patch` changing a file (`fileChange`) | `edit_file` |
| Grep | | `search_files` |
| Glob | | `find_files` |
| WebFetch | | `run` (judged as a fetch) |
| ToolSearch | `tool_search` | allowed, with no effect on the PC |

### 1.4 Where it plugs into app.js

One branch in the message route, before the provider loop (app.js ~3160):

```
engineId = session.engine?.id ?? settings.engine ?? 'bunny'
if engineId !== 'bunny' && workMode === 'code' && workspace && !req.bunnyRemote → runEngineTurn(...)
```

`runEngineTurn` reuses what is already there:
- `send`, `replyStatus`, `waitNudges`, `askPermission`, `keepForModel`, `stepsTaken`;
- checkpoints, `noteRemoteMode`, `remote.logAction`;
- `runHooks` (UserPromptSubmit and Stop).

The page needs no new event types.

**Scope:**
- Engines run only for Code-mode chats with a folder. Chat mode, chats with no folder, schedules and Quick ask stay on Bunny's own engine.
- A Chats-level device never runs an engine.
- A chat's engine and auth mode are fixed when its first message is sent. A change in Settings applies to new chats.

### 1.5 Chat continuity

- The next message resumes the CLI's own session: Claude Code with its session id; Codex with its thread, kept in the chat's home.
- The session files live in the chat's isolated folder (§7.3), and are deleted with the chat. An incognito chat's folder is removed when the reply ends.
- If a session can't be resumed (another version, or its files are gone), Bunny starts a new one. It sends Bunny's own transcript, cut by `shrinkConversation`, and says so in one line.

---

## 2. Bunny's local model endpoint (local mode only)

An engine in **account** mode doesn't use this endpoint at all: it talks to its vendor directly (§7).

### 2.1 Shapes

`endpoint.js` opens one listener per run, on `127.0.0.1` with port 0. It closes on the run's end, on Stop, and when Bunny quits (CE-4).

| Path | Used by | What Bunny does |
|---|---|---|
| `POST /v1/responses` | Codex (its only wire, F1 §2) | **The Responses translator**, `translate/responses.js`: Responses → Chat Completions to the owner's provider, and the Chat stream → a Responses stream back. The largest single work item. |
| `POST /v1/messages` (+ `/count_tokens`) | Claude Code | **The Messages translator**, `translate/messages.js`: Messages ⇄ Chat. It drops `adaptive` thinking and `context_management`, which providers reject (F2 §2's documented 400s). The adapter sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`. |
| `GET /v1/models` | both | one entry: the chat's model label |

Anything else gets a 404.

**Each translator is pure functions with fixtures**, covering in each direction:
- the input (Responses `message` / `function_call` / `function_call_output` items, or Messages `tool_use` / `tool_result` blocks) ⇄ messages and `tool_calls`;
- `instructions`, the `developer` role and `system` ⇄ a system message. Some servers reject `developer` (F1 §2);
- reasoning and thinking ⇄ thinking where the provider has it, and dropped where it doesn't;
- tools ⇄ functions;
- the streaming events ⇄ `chat.completion.chunk`;
- usage, and stop reasons.

**Responses' stored state** (`previous_response_id`, `store`) is not offered. Codex runs with `ephemeral: true` and sends its full input each turn (S2 e). A request that needs stored state is refused with a plain error.

**Native pass-through:** where a provider serves `/v1/responses` or `/v1/messages` natively, the call may pass through after the same checks **[R13]**.

### 2.2 Who may call it (CE-4)

Every request must pass all of these, or it gets a 403 with no detail:
1. `Host` is exactly `127.0.0.1:<port>`.
2. **No `Origin` header and no `Sec-Fetch-*` header**, so no web page can reach it.
3. The run's token arrives in `Authorization: Bearer` or `x-api-key`. It is `randomBytes(32)`, checked with `timingSafeEqual`, and dies with the run.
4. The body is JSON, at most `MAX_MESSAGE_BODY`, on a listed path.

**Further limits:**
- At most 4 requests at once per run.
- There are no CORS headers, every response has `cache-control: no-store`, and no upstream headers are passed on.
- Upstream error text passes through `looksSecret` before it reaches the CLI.

**The token reaches the CLI by environment only** (O6, CE-4.3):
- **Codex:** `[model_providers.bunny]` in the isolated `config.toml` (`base_url`, `env_key = "BUNNY_ENGINE_TOKEN"`, `wire_api = "responses"`, `requires_openai_auth = false`). So no OpenAI account is needed (F1 §6).
- **Claude Code:** `ANTHROPIC_BASE_URL` set to the endpoint, and `ANTHROPIC_AUTH_TOKEN` set to the token, both in the environment.

### 2.3 Routing

- **The model:** the endpoint ignores the model name the CLI sends. It answers with the chat's provider and model, or with Auto through `providerOrder` and "Try another model when yours is busy". Codex is still sent a fixed catalog name per pin (CE-1.16), because that name decides which tools it offers.
- **Keys** are read inside Bunny's process (`createProviderRegistry`, `secretStore`). The call goes out through `streamChat`'s fetch path, so these hold unchanged: `waitLimits`, `firstReplyWaitSeconds`, `refusesTools`, `refusesThinking`, and the fake upstream.
- **Usage** is counted against the real provider and model. **An engine run counts against the chat's `replyCaps` token budget**, and reaching it shows the existing `onLimit` card (CE-4.5).
- **Failures:** a model that refuses tools fails the run with Bunny's existing message. With the local network down, Auto may pick a local model; otherwise the run fails with Bunny's offline message. An engine is never pointed at a vendor URL in local mode.

---

## 3. Permissions: Bunny is the one judge

### 3.1 The decision

`bridge.js` decides with **the same functions Bunny's own engine uses, in the same order** (app.js ~2083–2100):

1. **Plan mode** refuses edits, commands, builds and sends (`planRefuses`).
2. **Deny rules:** `checkToolCall`, `checkCommand` (through `commandParts`) and `checkPath`, on the mapped tool.
   - Paths are canonicalised against the workspace root (realpath, 8.3 names, junctions, case) before the rules run (CE-1.5).
3. **Protected folders:** `protect: [dataDir]`, `neverBrowse`, and the `hidden` read-deny rules.
   - A write outside the workspace is denied.
   - **A read outside it is an Ask in every mode, Auto included** (CE-1.6).
   - **Always Deny:** the data folder; every engine home; `~\.claude`, `~\.codex`, `~\.cline` and `~\.aider*`; `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker` and `.config\gh`; `%APPDATA%` and `%LOCALAPPDATA%`.
4. **Ask rules**, then `needsOk` for the mode. An Ask reaches the person through `askPermission`: the same card and nudges, and no answer by the end of the reply means no. On a device at Everything, it is answered on that device.
5. **Allow rules**, then allow.

**Also:**
- An unknown tool is judged as `run`. A request whose input can't be read is denied.
- No decision is cached across calls, and a CLI's own "allow always" is never used.
- Bunny sends its one-line reason back (`describeRule`), and a refusal is named in the chat's step (CE-7.3).

### 3.2 Full mode: the layers

**The bridge listener** is a per-run `127.0.0.1` listener with the same checks as §2.2. It answers only its own run's requests. For Codex, approvals arrive in-band on the JSON-RPC channel, so no listener is needed.

#### Claude Code: five layers (Security 8369e8e and 70093c7). If any one is missing, it runs restricted.

1. **CE-1.7, the hook catches what it can.**
   - `hook.mjs` is one fixed text from Bunny's code. It is copied into the isolated home at every run start, and its sha256 is checked before the run.
   - It is started as `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and the script's absolute path, never a bare `node`.
   - It runs as a `PreToolUse` hook on every tool and calls the bridge. It blocks until Bunny answers.
   - The whole script is wrapped, so on every path it writes `permissionDecision: "deny"` or exits 2: an unreachable bridge, a bad or empty answer, any exception. **Exit 1, or any other code, would let the tool run.**
   - The isolated home is denied to the engine's own tools, so the agent can't edit the hook.
2. **CE-1.8, the engine's own permissions stay on**, as the second layer.
   - **Always `--permission-prompts none`.** `--permission-prompt-tool` is not used until a spike proves it answers through the bridge and denies when it is unreachable or crashed.
   - `--setting-sources user`, with an isolated `CLAUDE_CONFIG_DIR` (S1 b: neither the project's nor the home's hostile config loaded).
   - **No `permissions.allow` rule anywhere.** Never `--dangerously-skip-permissions`, `bypassPermissions` or `acceptEdits`.
   - In Plan mode, `--permission-mode plan` as well.
   - With the hook dead, the engine itself then refuses writes, commands, fetches, MCP, and reads outside the folder (S1 `e-killed-noprompts`).
3. **CE-1.9, Bunny's rules go into the engine's own settings.** Bunny's `--settings` holds `permissions.deny` for:
   - every Bunny deny rule;
   - every hidden path, the data folder and every engine home;
   - the protected folders and the always-Deny list (§3.1);
   - **every Bunny read-Ask path**, because a hook allow doesn't pass a `permissions.ask` read (S1 addendum 2).

   There is **no `permissions.ask`**. The cost is that Claude Code never reads those paths, even when the person would say yes, and the chat says so in one line.
4. **CE-1.10, the stream watchdog (M6).**
   - Every `tool_use` id must have a bridge request for the same id **before** its `tool_result`.
   - If one doesn't, the hook isn't working. The run is tree-killed at once and marked "stopped: Bunny's check did not run", and restricted mode is offered.
5. **CE-1.11, a long hook timeout.** The hook's timeout in `--settings` is 300 s, above the longest an Ask card waits, and the bridge answers deny itself at 150 s. S1 addendum 2: a card answered at 120 s allowed, and Bunny's deny at 150 s denied.

**Also, for Claude Code:**
- **`--disallowedTools`, in both modes.** It names `WebSearch Agent Task Skill CronCreate CronDelete CronList EnterWorktree ExitWorktree`, which S1 addendum 3 proved: each is absent from `system/init`, refused when called (subagents included), and never reaches the hook. It also names `TaskCreate TaskGet TaskList TaskUpdate TaskStop SendMessage ListAgents ScheduleWakeup Workflow ReportFindings Monitor` by the same mechanism.
- **The tool-list check** at `system/init`:
  - full mode: `Read Write Edit Glob Grep NotebookEdit Bash WebFetch ToolSearch`, plus PowerShell only when `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` is set by Bunny;
  - restricted mode: the same minus `Bash`, `PowerShell` and `WebFetch`.
  - Anything else stops the run.
- **MCP:** `--strict-mcp-config` with no MCP config. Bunny's own tools aren't offered in v0.1.14.
- **Environment:** `DISABLE_UPDATES`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and `DISABLE_TELEMETRY`. S1's proxy check saw no host but the stand-in.
- **The binary:** `claude-code-win32-x64` 2.1.311, `claude.exe` (219 MB) with sha256 `966f4b2ce962298f5dee6a942e8c47c8f97392e69e728e622319a98b259c0680`, Authenticode `CN="Anthropic, PBC"`, installed with `--ignore-scripts`.

#### Codex CLI: six layers (Security 70093c7). If any one is missing, it runs restricted.

1. **CE-1.12, the policy.** Always `approval_policy = "untrusted"`, never `on-request`, `never` or `granular`, and no `experimentalApi`. The answers are `accept`, `decline`, or `cancel` on Stop, **never `acceptForSession`**. `permissions/requestApproval` is always declined.
2. **CE-1.13, what Bunny judges.**
   - `item/commandExecution/requestApproval` is judged as `run_command` on its command text, exactly as Bunny's own engine: `checkCommand`, deny rules, Ask in Ask mode, refused in Plan.
   - `item/fileChange/requestApproval` is judged per path, as `write_file` or `edit_file`, every path canonicalised. A path outside the workspace, or in a protected, hidden, data or engine-home folder, is declined.
   - Unreadable input is declined.
3. **CE-1.14, tools off in full mode too:**
   - `features.view_image=false`, because it reads outside the folder with no ask (S2 d);
   - off as well: `apps`, `plugins`, `remote_plugin`, `plugin_sharing`, `tool_suggest`, `computer_use`, `image_generation`, `goals` and `hooks`, and `web_search="disabled"`. Without them S2 saw github.com, api.github.com and chatgpt.com contacted.
4. **CE-1.15, configuration.**
   - The isolated `CODEX_HOME/config.toml` is **rewritten at every run start**, with **no `trust_level`** for any project. The first run writes `trust_level = "trusted"` (S2); the project must stay untrusted, so its `.codex` config, hooks and exec-policy rules never load.
   - Also: `--ignore-user-config` where available, `check_for_update_on_startup=false`, `analytics.enabled=false`, and `thread/start {ephemeral: true}`.
   - **Still owed by Builder C (§6.1):** a project `.codex/rules` with an `allow`, in an untrusted project, still gets asked for every command.
5. **CE-1.16, second walls.**
   - `windows.sandbox="unelevated"` with `workspaceWrite`, and `readOnly` in Plan mode. It confines writes, not reads, and is never elevated (CE-5.6).
   - **A fixed model name per pin:** `gpt-5.5` for 0.170.0, from Codex's bundled catalog. An unknown name offers no `apply_patch`.
   - **The tool-list check** at `thread/start`:
     - full mode: exactly `exec_command`, `write_stdin`, `apply_patch`, `request_user_input` and `tool_search`;
     - restricted mode: `apply_patch`, `request_user_input` and `tool_search`.
     - Anything else stops the run.
6. **CE-1.17, the watchdog.** Every `item/started` of type `commandExecution` or `fileChange` must follow an approval Bunny accepted for that item. One that doesn't is tree-killed at once, and restricted mode is offered.

**The binary:** `codex-x86_64-pc-windows-msvc.exe.zip` from release `rust-v0.170.0`: 215 MB, sha256 `b1634415b6ecb87fea80691580dfe49f83fd46f0ad93f128ba029604d7faa158` (it matches the release digest), and 602 MB unpacked. Authenticode is `OpenAI OpCo, LLC`. It includes `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`, `codex-exec-server` and `rg.exe`.

### 3.3 Restricted mode: the staged copy (CE-2)

1. **Copy.** Before the turn, `staging.js` makes a plain file copy of the workspace in `engines\<id>\stage\<chat>`, with no `.git` and no link back. It leaves out the paths in §0.2 step 1, **skipping** every symlink, junction and reparse point rather than following it. The engine runs with that copy as its `cwd`.
2. **No commands, web, MCP or subagents** (§0.2 step 2).
3. **Judge every changed path.** When the turn ends, Bunny diffs the copy against the real folder, including renames and file-type changes. It judges each path with §3.1, as `write_file` or `edit_file`.
   - **Always discarded, and named in the reply:** anything under `.git` or an engine-config folder; alternate data streams (a `:` after the drive); reserved names, and names ending in a dot or space; links; files over the write limit.
   - **"Runs code later" files are Ask in every mode, Auto included,** marked on the card: `package.json`; `.vscode\tasks.json`, `.vscode\settings.json` and `.vscode\launch.json`; `.github\workflows\*`; `Makefile`; `*.ps1`, `*.bat` and `*.cmd`; `.husky\*` and `.pre-commit-config.yaml`; `pyproject.toml` and `setup.py`.
   - Denied paths are discarded and named. An Ask shows one card listing the files. Plan mode keeps nothing.
4. **Apply.** What is allowed is written through the workspace's own write path (`beforeWrite`, checkpoints, the Changes pane), so M7 holds. The copy is then removed.

### 3.4 Second walls, for both engines

- The isolated home is **rewritten at each run start** (§7.3).
- The environment is `safeEnv`, plus only the named variables. It holds no provider keys, no `GITHUB_TOKEN`, and no paths to the person's home config.
  - A local-mode run's environment carries no vendor credential variable.
  - An account-mode run's environment carries no endpoint token (CE-3.4).
- A command that a full-mode engine runs can reach the network, as `run_command` can today. It is judged as a command.

### 3.5 Devices and the action log

| Who | Choose an engine or auth mode; download, update, roll back, remove; sign in or out | Chats run on an engine |
|---|---|---|
| Bunny's window | yes | yes |
| a device at Everything | **no**: refused by `isDeviceRefused` (CE-6) | yes, if the window chose it. Every engine tool goes to `remote.logAction` as `{kind: 'tool', tool: '<engine id>:<mapped name>'}`, by name only. Its Asks are answered on that device |
| a device at Chats | no | no: its chats always use Bunny's engine |

**The CE-6 fix.** Being window-only isn't enough, because a device at Everything counts as the window.

1. `remoteAccess.js` gains `isDeviceRefused(method, path, body)`. It is true for:
   - `isRemoteAdminPath(path)`;
   - `^/api/engines(/|$)`;
   - `PUT /api/settings` with `engine` or `engines` in its body;
   - `POST /api/sessions`, or `PATCH /api/sessions/<id>` and the session-setting route, with `engine` in its body.
2. It is checked in three places: in `remoteRoute`'s Everything branch, in `route()`'s belt for `req.bunnyDevice`, and in `windowOnly()`'s `req.bunnyDevice` branch, on the decoded path.
3. The refusal message is: "Only Bunny's window can change engines."

Also: `engine` and `engines` join `WINDOW_ONLY_SETTING_KEYS`, `session.engine` joins `WINDOW_ONLY_SESSION_SETTINGS`, and `/api/engines*` joins `WINDOW_ONLY_ROUTES`.

### 3.6 Security's requirements, at a glance

They are binding. The full text is `docs/security/2026-11-18-cli-engines-requirements.md`.

| CE | Where in this spec |
|---|---|
| CE-1 (fail closed; CE-1.7 to CE-1.11 for Claude Code; CE-1.12 to CE-1.17 for Codex) | §3.1, §3.2 |
| CE-2 (restricted mode) | §0.2, §3.3 |
| CE-3 (account homes; the person's homes never loaded) | §3.4, §7 |
| CE-4 (local endpoint) | §2 |
| CE-5 (downloads, hashes, tested pins only, a Security sign-off per pin change, no elevation) | §4 |
| CE-6 (devices) | §3.5 |
| CE-7 (the record) | §4.4, §3.5 |
| CE-8 (starting the process) | §1.3 |
| CE-9 (what Security signs each engine on: the spike evidence, CE-1's failure set showing deny, the canary unread or the owner's answer, the fake-home test, the CE-6 test at Everything, and the store tests) | §5, §6 |

---

## 4. Download on click, versions, updates, rollback (CE-5)

### 4.1 Licences and terms

| Engine | Licence | Bunny may |
|---|---|---|
| Claude Code | "All rights reserved" plus Anthropic's Commercial Terms (F2 §3) | download the official package (`@anthropic-ai/claude-code-win32-x64`) on the owner's click and run it unmodified, with its own sign-in intact. Bunny never collects claude.ai credentials (report §7a). |
| Codex CLI | Apache-2.0 (F1 §3) | download the release asset and run it. The licence and notices are shown in About. |

### 4.2 Layout (nothing in the installer)

```
%LOCALAPPDATA%\BunnyAI\engines\<id>\<version>\...          one folder per downloaded version (BUNNY_DATA_DIR\engines in tests)
%LOCALAPPDATA%\BunnyAI\engines\<id>\current.json           { version, sha256 }: which version runs
%LOCALAPPDATA%\BunnyAI\engines\<id>\<mode>\shared\         per engine and mode (7.3)
%LOCALAPPDATA%\BunnyAI\engines\<id>\<mode>\chat\<chat>\    per chat: the CLI's session files (1.5)
%LOCALAPPDATA%\BunnyAI\engines\<id>\stage\<chat>\          restricted mode's staged copy, removed after each turn
%LOCALAPPDATA%\BunnyAI\engines\record.json                 the engine record (CE-7)
```

Settings shows each engine's size on disk, and a **Remove** button that deletes every version, home, staged copy and record entry of that engine.

### 4.3 Pins

`src/server/engines/pins.json` ships with every Bunny release, and lists **tested versions only**:

```json
{ "claude-code": { "version": "2.1.311", "files": [ { "url": "https://registry.npmjs.org/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-2.1.311.tgz", "integrity": "sha512-…", "sha256": "…" } ],
                   "exe": "claude.exe", "exeSha256": "966f4b2ce962298f5dee6a942e8c47c8f97392e69e728e622319a98b259c0680", "signer": "Anthropic, PBC",
                   "hosts": ["registry.npmjs.org"] },
  "codex": { "version": "0.170.0", "files": [ { "url": "https://github.com/openai/codex/releases/download/rust-v0.170.0/codex-x86_64-pc-windows-msvc.exe.zip", "sha256": "b1634415b6ecb87fea80691580dfe49f83fd46f0ad93f128ba029604d7faa158" } ],
             "signer": "OpenAI OpCo, LLC", "model": "gpt-5.5", "schema": "codex-app-server-0.170.0/",
             "hosts": ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] } }
```

- The npm tarball's URL and integrity value are taken from the registry when the pin is tested. The Codex asset host list is confirmed at the first download **[R25]**.
- **Tested** means QA's `engine-smoke` passed on an invented profile, and its fixtures were recorded from that version.
- Between Bunny releases, a newer tested set may come as an `engines.json` asset on Bunny's own GitHub Releases feed (`RELEASES_FEED`), with a sha256 for every file.
- **There is never a "latest, untested" option. Every pin change is a Security sign-off** (CE-5.4).

### 4.4 Download, update, switch, rollback

All of these are window-only routes, and device-refused (§3.5).

1. **`GET /api/engines`:** per engine, whether it's downloaded, the running version, the tested version available, the size, and whether a previous version is kept.
2. **`POST /api/engines/<id>/download`** (also used for an update):
   - HTTPS only, from the pinned URL, with every redirect hop on the pin's `hosts` list;
   - into `engines\<id>\.staging-<rand>`, with progress and Cancel in Settings;
   - every file's `sha256` is checked, and npm's `integrity` too;
   - the Authenticode signer of the `.exe` is checked against `signer`;
   - unpacking refuses absolute paths, `..`, drive letters, symlinks and hardlinks, alternate data streams and reserved names, and stops at 2 GB in total;
   - npm uses `--ignore-scripts`;
   - then `<cli> --version` runs there, with `safeEnv`, no network and a 10 s timeout. It must print the pinned version.
   - Any failure removes the staging folder, and says why.
3. **Switch:** rename the staging folder to `engines\<id>\<version>`, then write `current.json` atomically. Never while a run of that engine is going; the update then says "after the current reply". A run that has started keeps its version.
4. **Keep two:** the previous version is kept, and older ones are removed (`removeTree`).
5. **Rollback:** `POST /api/engines/<id>/rollback`. If the current version fails `locate()` at a run start (missing, or its hash changed on disk), the run says so and offers rollback. With no previous version, new chats use Bunny's own engine.
6. **The CLIs' own self-update is off** (§3.2). Only this flow changes what runs. Elevation is never asked for.
7. **The engine record (CE-7):** download, update, switch, rollback, remove, sign-in, sign-out and auth-mode changes. Each entry holds the time, the engine, the old and new version, the first 12 characters of the sha256, and who (always the window). It is shown in Settings → Engines.

---

## 5. Tests and the gate

### 5.1 Nothing real in the gate

`fake-engine.mjs` stands in for either profile, selected with `BUNNY_FAKE_ENGINE=<profile>:<script>`:
- it replays a recorded script (jsonl or json-rpc);
- it calls the hook or sends approval requests;
- in restricted mode, it edits its staged copy;
- its model calls go through the run's endpoint to the fake upstream.

The gate runs no real CLI, uses no network and needs no account. TEST-DNS's no-network preload is in force.

### 5.2 Unit tests (new files)

| File | What it proves |
|---|---|
| `test/engine-events.test.js` | Each adapter's parser gives exactly the expected events on fixtures recorded from the pinned version (`test/fixtures/engines/<id>/<version>/`, invented profile, fake upstream). A malformed or over-long line, or an unknown method or event, ends the run. Codex's methods match the pinned schema. |
| `test/engine-endpoint.test.js` | The listener is 127.0.0.1 only. It refuses a wrong Host, any Origin or `Sec-Fetch-*`, a wrong or missing token, another run's token, and a request after the run. The CLI's model name is ignored. **Both translators** round-trip text, thinking or reasoning, tool calls and results, the system/developer text, stop reasons and usage, streaming and not. Stored-state requests are refused. Upstream error text goes through `looksSecret`. No key appears in anything sent to a CLI. At most 4 requests run at once. An engine run counts against `replyCaps`. |
| `test/engine-bridge.test.js` | For every mode × rule effect × mapped tool, the decision equals Bunny's own engine's. Outside reads are Ask in every mode. The always-Deny list holds. An unknown tool is judged `run`. Unreadable input is denied. Nothing is cached. No answer by the end of the reply means no. |
| `test/engine-hook.test.js` | **CE-1.7:** `hook.mjs` prints a deny for an unreachable bridge, a garbage answer, an empty answer, a thrown exception and Bunny's own 150 s limit. Its sha256 is checked before a run. It is started by absolute path, with `ELECTRON_RUN_AS_NODE=1`. |
| `test/engine-claude-args.test.js` | **CE-1.8, CE-1.9 and the extras:** the spawn always has `--permission-prompts none`, `--setting-sources user`, `--strict-mcp-config` with no MCP config, and `--disallowedTools` with the listed names. It never has `--dangerously-skip-permissions`, `bypassPermissions`, `acceptEdits`, `--permission-prompt-tool` or a `permissions.allow`. Plan mode adds `--permission-mode plan`. The `--settings` file holds `permissions.deny` for every listed kind **including read-Ask paths**, **no `permissions.ask`**, and the 300 s hook timeout. Restricted mode adds `--restricted`. A `system/init` tool list outside the expected set stops the run. The prompt is never in the arguments. |
| `test/engine-claude-watchdog.test.js` | **CE-1.10:** with the hook disabled, a `tool_use` then a `tool_result` with no bridge request is tree-killed, marked "stopped: Bunny's check did not run", and offered restricted mode. A bridge request first keeps it going. A result for an unknown id also stops it. |
| `test/engine-codex-args.test.js` | **CE-1.12 to CE-1.16:** `initialize` has no `experimentalApi`. `thread/start` has `untrusted`, `ephemeral: true` and the pinned model. Bunny never answers `acceptForSession`, and declines `permissions/requestApproval` and the legacy approvals. `config.toml` has every CE-1.14 feature off, `web_search="disabled"`, analytics off, the update check off, and **no `trust_level`**, and it is rewritten when a run left one. A tool list beyond the expected set stops the run. Restricted mode adds `shell_tool`, `unified_exec` and `view_image` off. A file change outside the workspace or in a protected path is declined. |
| `test/engine-codex-watchdog.test.js` | **CE-1.17:** an `item/started` for `commandExecution` or `fileChange` with no accepted approval first is tree-killed and offered restricted mode. With one first, the run goes on. |
| `test/engine-staging.test.js` | **CE-2:** the copy leaves out the listed paths, and skips links. Always-discarded paths are named. "Runs code later" files ask in Auto too. Renames, type changes and deletes are judged. Only allowed changes are applied, through the write path and checkpoints. Plan mode keeps nothing. The copy is removed afterwards. |
| `test/engine-store.test.js` | **CE-5:** a hash or integrity mismatch, a wrong signer, an archive path-escape, an over-2 GB archive, a redirect off the host list, or a wrong `--version` is refused, and staging is removed. npm runs with `--ignore-scripts`. `current.json` is written atomically. Rollback works. An update waits during a run. Remove deletes everything. The engine record is written. A fake registry is used, with no network. |
| `test/engine-device.test.js` | **CE-6, over real HTTP at Everything:** a device is refused `/api/engines*`, the `engine` and `engines` settings, and `session.engine` on create and on change. A Chats device's Code-mode chat runs on Bunny's engine. An Everything device's engine tools are logged by name only. |
| `test/engine-env.test.js` | **CE-3 and CE-8:** the environment is `safeEnv` plus the named variables only. There's no credential variable in local mode, and no endpoint token in account mode. A fake `USERPROFILE` with hostile `.claude` and `.codex` configs is not loaded. The home is rewritten at each start. An incognito chat's folder is removed. The prompt and the token never appear in the arguments. A tree kill leaves no process behind. |

### 5.3 End-to-end (Playwright, invented profile, fake engine)

- **Settings → Engines lists exactly two engines**, Claude Code and Codex CLI. For each: the auth-mode choice (Sign in with an account, or Operate locally); the local-mode note on Claude Code; download with progress and Cancel; update; rollback; Remove; the size on disk; the record. Both themes, at phone and desktop widths (O3, O8).
- **A Code-mode chat on each fake engine:** steps, Verbose results, the Changes pane and Stop work; an Ask card is answered; Plan mode refuses.
- **The watchdog:** a run stopped by it offers restricted mode. Accepting shows the restricted line and Bunny's file review.
- Switching engine applies to new chats only. Help text and pictures ship with the screen (O7, PICTURE-CHECK).

### 5.4 The gate

1. **A new step, "engine pins"** (`scripts/engine-pins.mjs`, with its own test). It checks:
   - that `pins.json` parses;
   - that every file has an https URL on its `hosts`, a sha256, and the npm integrity value where there is one;
   - that a signer is named;
   - that Codex's schema folder is there;
   - that both licences are shown in About.
2. **The dependency audit can't see downloaded engines.** The pins step and the Security sign-off per pin change stand in for it.
3. **The secret scan covers the fixtures.** Recording uses only the invented profile and the fake upstream.
4. **Outside the gate:** `scripts/engine-smoke.mjs`, run by QA before any pin change. It downloads the real pinned engine into an invented profile and runs it through the real endpoint against the fake upstream. It also:
   - re-runs the canary check, and the network check (no host but the endpoint);
   - records fresh fixtures, and the expected tool lists;
   - fails if any of those changed.

---

## 6. Build order (each a board row; HIGH rows keep an independent review and Security's sign-off)

### 6.1 The spikes

| Spike | Result |
|---|---|
| S1, Claude Code 2.1.311 (e1e568f, c532469, 7b1f864, 2a92e8f, 4b74686) | **Done.** Full mode with CE-1.7 to CE-1.11 (§3.2). Nothing owed. |
| S2, Codex 0.170.0 (401bd92) | **Done.** Full mode with CE-1.12 to CE-1.17 (§3.2). **One line owed (CE-1.15):** in an untrusted project, a project `.codex/rules` with an `allow` still gets asked for every command. If it doesn't, Security rules again before Codex ships. |
| S3, Cline (767c4ea) | Done, and failed: §11. |
| S4, Aider | Not run. Aider is later (§11). |

The canary rule stays for every future pin: the canary's unique string is searched for in every request the endpoint receives, and in the engine's output (`engine-smoke`).

### 6.2 The build, for Builder C

1. `events.js`, `bridge.js` with `hook.mjs`, and `staging.js`, with their tests, on the fake engine.
2. `endpoint.js` with the **Responses translator**, and its tests.
3. **The Codex adapter**, full and restricted, with its argument and watchdog tests. Then S2's owed `.codex/rules` line.
4. **The Claude Code adapter in account mode**, full and restricted, with its argument, hook and watchdog tests. Account mode needs no translator.
5. **The Messages translator**, for Claude Code in local mode.
6. `store.js`, `pins.json` and the `/api/engines` routes, plus the sign-in and sign-out flows (§7.1) and the CE-6 `isDeviceRefused` changes.
7. **The Settings → Engines screens**, from Design's drawing (it's to be redrawn for two engines): the auth-mode choice, the restricted line, the sign-in states, download, update, rollback and Remove, the record, and the local-mode note.
8. The "engine pins" gate step, `engine-smoke.mjs`, help text and pictures.

---

## 7. Auth modes: account or local (owner's word 4)

**The choice.** Settings → Engines shows, in front of each engine, **Sign in with an account** or **Operate locally**.
- It is kept per engine as `engines.<id>.auth`: window-only, and device-refused.
- A chat records the engine and mode it started with.

| Engine | local | account | Default |
|---|---|---|---|
| Claude Code | `/v1/messages` through the Messages translator, with the note in §7.2 | `claude auth login` in a visible terminal, in the account-mode `CLAUDE_CONFIG_DIR` (report §7a). Claude models on the owner's Anthropic plan | account |
| Codex CLI | `/v1/responses` through the Responses translator, with `requires_openai_auth = false` | Codex's own login, in the account-mode `CODEX_HOME` **[R20]** | local |

### 7.1 Account mode: what Bunny does and does not do

- **Sign-in is the vendor's own flow, run visibly by the owner.** Bunny opens a terminal with only the account-mode home variable set, and runs the vendor's fixed command, from the pinned binary by absolute path. The owner finishes it in the vendor's browser page, and the CLI writes its own credential file inside that home. Only Bunny's window can start a sign-in or a sign-out.
- **Bunny never reads, copies, hashes, logs, exports, backs up or searches the account home** (CE-3.1).
  - Bunny writes only its own config files there, by name.
  - The home is left out of the secret-scan walk, Activity, chat export, staged copies and SEARCH-PC.
  - The engine's own tools are denied any read of it (§3.1).
  - There is no `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or `setup-token` in Bunny's store, and no sign-in form of Bunny's own. This is what Anthropic's terms require (report §7a).
- **Sign-in state** comes only from the CLI's own status output, or from a run's error, such as "Sign in again" **[R21]**.
- **Sign out** runs the vendor's own logout in that home, then deletes the home.
- **The engine talks to its vendor directly.** Bunny's endpoint isn't started, and `ANTHROPIC_BASE_URL` isn't set. The Usage page shows the run as "billed by <vendor>", with no token cost.
- **Bunny's rules still judge every action**, as in §3: the same layers, Plan mode, protected folders, devices, the action log and checkpoints.

### 7.2 Local mode for Claude Code: the plain note

Under "Operate locally" on the Claude Code row, exactly:

> Not supported by Anthropic. Claude Code may stop working with your models after an update.

It stays visible while local mode is chosen. Anthropic says it "doesn't support routing Claude Code to non-Claude models through any gateway" (F2 §2). The pin and rollback (§4.4) are the remedy when an update breaks it.

### 7.3 Isolated homes per engine and per mode

```
engines\<id>\local\shared\         Bunny's pinned config for local mode (provider = Bunny's endpoint, hook, deny rules): rewritten at every run start
engines\<id>\account\shared\       the vendor's credential (written only by the vendor's login) plus Bunny's pinned config: Bunny rewrites its own config files only
engines\<id>\<mode>\chat\<chat>\   per-chat session files
```

- The CLI is pointed at its mode's `shared` folder (`CLAUDE_CONFIG_DIR` or `CODEX_HOME`).
- Whether a chat's session files sit in a subfolder or in a per-chat copy of the config is **[R22]**, to be settled in build step 3 or 4.
- The two modes never share a folder.
- Incognito chats get a temporary chat folder that is removed after the reply.

---

## 8. Open facts

| Mark | Fact | If it comes back wrong |
|---|---|---|
| R13 | Which of Bunny's providers serve `/v1/responses` or `/v1/messages` natively | Always translate |
| R20 | Codex's own login command, and where it writes the credential under `CODEX_HOME` | Codex is local only |
| R21 | Each engine: a way to read the sign-in state without reading the credential | State known only from a run's error |
| R22 | A per-chat session folder separate from the config home | A per-chat copy of the config |
| R25 | The hosts GitHub redirects a release download through | The pin's `hosts` list is corrected at the first download |
| CE-1.15 line | A project `.codex/rules` `allow` in an untrusted project still asks | Security rules again before Codex ships |

**Settled:** R10, R12, R14, R18 and R23 are settled by S1 and S2. The owner accepted R23. The Aider and Cline items are in §11.

## 9. The owner's questions

All are answered:
1. Engines that can't check with Bunny first: "restricted mode".
2. Codex's read residual (R23): "codex approved".
3. Cline: "leave cline out of 0.1.14".
4. Scope: "lets remove cline and other for now, just focus on codex and claude".
5. Updates: tested only, and every pin change gets a Security sign-off (Security, CE-5.4).

**Still for Design and Security to confirm (§1.4):** engines for Code-mode chats only, with Chat mode always on Bunny's own engine. The recommendation is yes.

## 10. What this spec doesn't cover

Bunny's own tools offered to an engine, as a Bunny MCP server behind the bridge; Chat-mode engine chats; and helper agents through an engine. Each would be its own HIGH row.

---

## 11. Later: Aider and Cline (not in v0.1.14)

**The decision:** the owner: "lets remove cline and other for now, just focus on codex and claude." Earlier, for Cline: "leave cline out of 0.1.14", with Security's ruling 2fd5b2b. **Neither appears in Settings → Engines,** not even greyed out.

### 11.1 Cline (S3, 767c4ea)

| Area | Finding | Breaks |
|---|---|---|
| Full mode | `--auto-approve false` refuses every tool in headless mode; `--acp` needs an account; `--auto-approve true` leaves the hook as the only wall, and it fails open. There is no engine-side second layer | CE-1, CE-1.8 |
| Restricted mode | With `disabledTools`, `read_files` reads outside the folder, and **`editor` writes outside it**, with the hook allowing and with it killed | M2, CE-2 |
| Network | `data.cline.bot` (PostHog) is contacted on every run, despite every opt-out | M5, CE-5.5 |
| Configs | The project's own `.cline/hooks` load and run on every call | CE-3.3 |
| Processes | A hub daemon outlived a killed run | CE-8.2 |
| The key | Kept in `providers.json` in plain text | M3 (a note) |
| Install | The npm `postinstall` script writes to `~/.cline/data` (avoidable with `--ignore-scripts`) | CE-5.1 |

**Security's conditions for looking again** (2fd5b2b). A later version comes back as a new spike only if it shows all of:
1. a host approval channel that works in local mode without an account, or file tools confined to the working folder;
2. a way to turn off its network calls besides the model endpoint;
3. a switch to stop the project's own hooks;
4. no process outliving the run.

### 11.2 Aider (not spiked)

**Researcher's facts** (report §7b):
- Apache-2.0;
- **no structured output** (only text plus a git diff), and **no permission controls or hook**;
- `OPENAI_API_BASE` with `--model openai/<name>`;
- Python 3.10–3.12, installed through `uv`;
- last release v0.86.0 (2025-08-09), PyPI 0.86.2.

**It could only ever run in restricted mode** (the staged copy). The open questions were:
- whether shell suggestions, `/run`, `/test`, git, analytics and the update check can all be turned off, with no hang when there is no terminal (R6);
- a hash-locked offline install (R8);
- whether it can read outside its folder (R19).

These are S4's plan, as it stood in revision 8.

### 11.3 What adding either back would take

**The adapter interface** stays open for them (§1.2):
- **Aider** would need a `text` transport (steps built from the staged copy's diff), a `chat` wire on the endpoint (`POST /v1/chat/completions`, a pass-through), a `python` runtime managed through a pinned `uv`, and a "staged only" approval kind.
- **Cline** would need a `node` runtime (Electron's own Node, or a pinned one) and its `--json` reader.

**The process:** a new spike against Security's conditions, then Security's ruling, then the owner's word. Each is its own row.
