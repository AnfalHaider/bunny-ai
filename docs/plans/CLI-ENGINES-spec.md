# CLI-ENGINES: architecture spec (draft, revision 2)

Tech Lead, 2026-11-18. Revision 2 replaces 0b6a2f9. It takes in:
- Researcher's report, e462903 (`docs/research/2026-11-18-cli-engines.md`);
- the owner's decisions, as relayed by the Chief of Staff.

Status: **draft**. Risk: **HIGH**: a new execution engine, a permission bridge, third-party code downloaded and run, and a local model endpoint.

Order of work:
1. Security sets the requirements.
2. Design draws Settings → Engines and the download, update and rollback states.
3. The owner's go is asked with the drawing.
4. Builder builds.

An ADR is filed once the open facts below are settled.

## The owner's words (typed in the Chief of Staff's chat, 2026-11-18)

1. "Yes, lets go with claude and codex , also the cli's should be bundled in the application, with the option to update them from within the application also."
2. "Claude Code, Codex CLI, Aider, Cline , add all these."
3. "my idea is that none work on accounts, since we are using custom models and anyway, so the CLI's should not require linking to an account."

What follows from them, as the Chief of Staff relayed it:
- **Four engines:** Codex CLI, Aider, Cline and Claude Code.
- **No accounts.** An engine works on the models Bunny provides, through Bunny's local endpoint, with no vendor account linked.
  - Codex, Aider and Cline fit that.
  - Claude Code does not fit it as Researcher found it. It needs the person's own paid Anthropic account, and Anthropic does not support it on other models. **Claude Code is with the owner** (§7).
- **Downloaded on click, never inside the installer.** Each engine is about 380 MB or more. Engines are stored per version, and updated and rolled back from Settings.
  - This replaces "bundled" in word 1. A download from inside Bunny is the owner's "from within the application"; carrying all four in the installer would make it several times larger.

**Assumption marks.** **[F*n*]** marks a fact Researcher has confirmed, with its section in e462903. **[R*n*]** marks a fact still waiting on Researcher; Aider and Cline are being added now. If a fact comes back different, the section that names it is revised before it is built.

**The rule throughout:** an engine whose facts fail a must is not offered. Bunny does not weaken a must to fit a CLI.

Code references are to main at 43ced06 (v0.1.13).

---

## 0. The musts

| # | Must |
|---|---|
| M1 | Bunny's own engine stays the default. Choosing an engine is a window-only setting. |
| M2 | Every action an engine takes on the PC is decided by Bunny **before it reaches the person's folder**: a command, a file write, a read outside the folder, a fetch, an MCP call. The same rules and modes apply as for Bunny's own engine. Two ways to meet it (§3): a per-call approval, or a staged copy that Bunny judges before anything is copied back. |
| M3 | An engine never sees a provider key or a sign-in token. It sees only a per-run token for Bunny's local endpoint. |
| M4 | An engine runs with its own isolated config home inside Bunny's data folder. It never reads the person's own `~/.codex`, `~/.aider*`, `~/.cline` or `~/.claude`, or their global MCP servers, hooks and rules. |
| M5 | No account (owner's word 3), and nothing paid (R4). No vendor sign-in, no telemetry, and no self-update that phones home. Updates come only through Bunny's pinned flow (§4). |
| M6 | Fail closed. If the approval channel is unreachable, an event cannot be parsed, or a run ends oddly, the run stops and says why. Nothing goes on unjudged. |
| M7 | Nothing an engine changes is left without a way back. Checkpoints and "Undo changes" work for an engine chat as they do for Bunny's own engine. |

Not in v0.1.14: Cursor CLI; Chat-mode chats on an engine (§1.4); Bunny's own tools offered to an engine (memory, artifacts, browser, connectors, helpers).

---

## 1. The adapter: one interface, four engines

### 1.1 Files

`src/server/engines/`:
- `index.js`: the registry;
- `codex.js`, `aider.js`, `cline.js`, `claude-code.js`: one adapter per engine;
- `events.js`: the event union;
- `bridge.js`: approvals, §3;
- `staging.js`: staged copies, §3.3;
- `endpoint.js`: the local endpoint and translators, §2;
- `store.js`: downloads, versions, rollback, §4;
- `fake-engine.mjs`: a scripted stand-in for tests, §5.

### 1.2 What an adapter declares

The four CLIs differ in how they talk, how they ask, and which API shape they speak, so each adapter declares those differences as data. Everything else in Bunny reads the declaration, never the engine's name.

```js
export const profile = {
  id: 'codex' | 'aider' | 'cline' | 'claude-code',
  label: 'Codex CLI' | 'Aider' | 'Cline' | 'Claude Code',
  transport: 'json-rpc' | 'jsonl' | 'text',    // how events arrive (1.3)
  approvals: 'per-call' | 'staged',            // how M2 is met (3.2 or 3.3)
  wire: 'responses' | 'chat' | 'messages',     // what it sends to the model endpoint (2.1)
  models: 'bunny' | 'own-account',             // 'own-account' only for Claude Code if the owner allows it (7); never offered while M5 stands
  resume: boolean,                             // can it pick up its own session by id (1.5)
  runtime: 'native' | 'node' | 'python',       // what it needs to run (4.2)
};
```

| Engine | transport | approvals | wire | runtime | Source |
|---|---|---|---|---|---|
| Codex CLI | `json-rpc` (`codex app-server`) | `per-call` (`item/*/requestApproval`) | `responses` | native | F1 §1–§2, §4 |
| Cline | `jsonl` or `json-rpc` **[R1]** | `per-call` if its headless mode carries approvals, else `staged` **[R2]** | `chat` (OpenAI-compatible provider) **[R3]** | node **[R4]** | waits |
| Aider | `text`, unless it has a structured output **[R5]** | `staged` (its edits are applied by Aider itself, with no per-call hook) **[R6]** | `chat` (OpenAI-compatible base URL) **[R7]** | python **[R8]** | waits |
| Claude Code | `jsonl` (`-p --output-format stream-json --verbose`) | `per-call` (`canUseTool` / `--permission-prompt-tool`) | `messages` | native (`claude.exe`) | F2 §1, §2, §4; held, §7 |

### 1.3 The run, and its events

```js
start({ runId, cwd, prompt, resume, mode, endpoint, approve, home, env, signal })
  → { events /* AsyncIterable<EngineEvent> */, stop() }
```

- `cwd` is the workspace root, or the staged copy for a `staged` engine (§3.3).
- `approve(request)` resolves to `{ allow, reason }` (§3.2). A `staged` engine never calls it.
- `env` is `safeEnv()` plus only what the adapter names (M3, M4).
- The CLI is spawned through `safeExec`: an absolute path and `windowsHide`. On `stop()`, a timeout or an abort, its whole process tree is killed with `taskkill /T /F` (the RUN-1 lesson).
- A run that prints nothing for the wait limit (`waitLimits`) ends the way `unit-tests.mjs` ends a hung run, and says so.

The event union is the same for every engine:

| EngineEvent | Bunny's SSE event (`send`, app.js ~1960) | Saved in the chat |
|---|---|---|
| `text {delta}` | `delta` | the assistant message |
| `thinking {delta}` | `thinking` | as today |
| `tool-start {callId, name, input}` | `tool {status: 'running'}` | a step, opened |
| `tool-end {callId, ok, output}` | `tool {status: 'done' \| 'failed', result}` | a step through `keepForModel`: `result` up to 1 200 characters; `modelResult` up to 8 000, never when it looks like a secret, never in an incognito chat |
| `approval {requestId, name, input}` | decided by the bridge; only an Ask reaches `send('permission')` through `askPermission` | the answer, as a step note |
| `question {requestId, text, options}` | `question` (the existing card), where the CLI has one: Claude Code's `AskUserQuestion` (F2 §1); Codex `mcpServer/elicitation/request` (F1 §1); others **[R9]** | as today |
| `edit {path}` | the Changes pane (`changesFor`) and checkpoints | as today |
| `usage {input, output}` | none; added to `usage.js` against the real provider (2.3) | |
| `session {engineSessionId}` | none | `session.engine = {id, sessionId, version}` |
| `done {stopReason}`, `error {code, message}` | `done`, `error` | |

How each transport is read:

- **json-rpc** (Codex `app-server`). The adapter does the `initialize` / `initialized` handshake, then `thread/start` (cwd, `approvalPolicy: on-request`, sandbox), then `turn/start`. It maps the `item/started`, `item/completed`, `item/agentMessage/delta` and `turn/*` notifications.
  - It answers `item/commandExecution/requestApproval` and the file-change approval request with `accept` or `decline`, from `approve()`.
  - Stop sends `turn/interrupt`.
  - The method names come from `codex app-server generate-json-schema` **for the pinned version**, kept beside the pin (F1 §1; several names are still UNKNOWN there). An unknown method or notification ends the run (M6).
- **jsonl** (Claude Code; Cline if [R1]). One JSON object per line, at most 1 MB a line. A line that is not valid JSON, or fails validation, ends the run (M6).
- **text** (Aider if [R5]). No structured stream. The adapter shows Aider's reply as text, and builds the steps from the staged copy's diff when the turn ends (§3.3): one `edit` step per changed file, and one `tool` step per command Aider ran, if any **[R6]**. The step view is coarser than for a `jsonl` or `json-rpc` engine. Design is to say so on the engine's Settings row.

**Tool names.** Each adapter maps its CLI's tool names onto Bunny's step names: `run_command`, `read_file`, `write_file`, `edit_file`, `search_files`, `find_files`. The CLI's own name rides along as `engineTool`. The names per CLI are **[R10]** (Codex: the item types in F1 §1). An unknown tool is judged as `run` (§3.2).

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

Scope choices, for Design and Security to confirm:
- Engines are used only for Code-mode chats with a folder. Chat mode, chats with no folder, schedules and Quick ask stay on Bunny's own engine.
- A device at the Chats level never runs an engine.
- A chat's engine is fixed when its first message is sent. A change in Settings applies to new chats.

### 1.5 Chat continuity

- Where `resume` is true (Codex `resume`, F1 §1; Claude Code; Cline and Aider **[R11]**), the next message picks up the CLI's own session.
- The CLI's session files live in the chat's isolated home inside Bunny's data folder, and are deleted with the chat.
- An incognito chat uses a temporary home that is removed when the reply ends.
- If a session cannot be resumed (another version, or its files are gone), Bunny starts a new one. It sends Bunny's own transcript, cut by `shrinkConversation`, and says so in one line.

---

## 2. Bunny's local model endpoint

### 2.1 Shapes

`endpoint.js` opens one listener per run, on `127.0.0.1`, port 0. It is closed when the run ends.

| Path | Used by | What Bunny does |
|---|---|---|
| `POST /v1/responses` | Codex (`wire_api = "responses"` is the only value it accepts, F1 §2) | **Translator:** Responses → Chat Completions to the owner's provider, and Chat stream → Responses stream back. This is the largest single work item. |
| `POST /v1/chat/completions` | Aider **[R7]**, Cline **[R3]** | Passed on to the owner's provider through the existing fetch path, after the checks in 2.2. |
| `POST /v1/messages` (+ `/count_tokens`) | Claude Code, only if the owner chooses the gateway route (§7) | Messages ⇄ Chat translator, forwarding `anthropic-version` and `anthropic-beta` (F2 §2). **Not built** while Claude Code is held. |
| `GET /v1/models` | all | One entry: the chat's model label. |

Anything else gets a 404.

**The Responses translator**, `translate/responses.js`, is made of pure functions with fixtures. In each direction it covers:
- input items, so `message`, `function_call` and `function_call_output` ⇄ messages and `tool_calls`;
- `instructions` and the `developer` role ⇄ a system message, since some local servers reject `developer` (F1 §2, issue 9392);
- `reasoning` ⇄ thinking where the provider has it, and dropped where it does not;
- tools ⇄ functions (Codex's built-in tools such as `apply_patch` and `shell` reach the model as functions);
- the streaming events (`response.created`, `response.output_item.added`, `response.output_text.delta`, `response.function_call_arguments.delta`, `response.completed`) ⇄ `chat.completion.chunk`;
- usage ⇄ usage.

State that Responses keeps on the server (`previous_response_id`, `store`) is not offered. The adapter sets `--ephemeral` or the equivalent, so Codex sends the full input each turn **[R12]**. A request that needs stored state is refused with a plain error.

Where a provider already serves `/v1/responses` natively, the call may be passed through after the same checks **[R13]**. Which of Bunny's providers do is UNKNOWN (F1 §2).

### 2.2 Who may call it

Every request must pass all of these, or it gets a 403 with no detail:
1. `Host` is exactly `127.0.0.1:<port>`.
2. **There is no `Origin` header.** A web page on the PC always sends one (the S-1 lesson).
3. The run's token arrives in `Authorization: Bearer` or `x-api-key`. It is `randomBytes(32)`, checked with `timingSafeEqual`, and dies with the run.
4. The body is at most `MAX_MESSAGE_BODY` and is JSON.

The responses never carry CORS headers, and always carry `cache-control: no-store`.

The token reaches the CLI by environment only, never on the command line (O6):
- **Codex:** `[model_providers.bunny]` in the isolated `config.toml` (`base_url`, `env_key = "BUNNY_ENGINE_TOKEN"`, `wire_api = "responses"`, `requires_openai_auth = false`). Codex then needs no OpenAI account (F1 §6).
- **Aider and Cline:** the adapter's OpenAI-compatible base URL plus a key variable **[R7] [R3]**.

### 2.3 Routing

- The endpoint ignores the model name the CLI sends. It answers with the chat's provider and model, or with Auto through `providerOrder` and "Try another model when yours is busy".
- Keys are read inside Bunny's process (`createProviderRegistry`, `secretStore`). The call goes out through `streamChat`'s fetch path, so these hold unchanged:
  - `waitLimits` and `firstReplyWaitSeconds`;
  - `refusesTools` and `refusesThinking`;
  - the fake upstream (`BUNNY_FAKE_UPSTREAM`).
- Usage is counted against the real provider and model.
- A model that refuses tools fails the run with Bunny's existing message.
- When the local network is down, Auto may pick a local model; otherwise the run fails with Bunny's offline message (the owner's 2026-11-16 rule). An engine is never pointed at a vendor URL.

---

## 3. Permissions: Bunny is the one judge

### 3.1 The decision (shared by both ways)

`bridge.js` decides with **the same functions Bunny's own engine uses, in the same order** (app.js ~2083–2100):

1. **Plan mode** refuses edits, commands, builds and sends (`planRefuses`).
2. **Deny rules:** `checkToolCall`, `checkCommand` (through `commandParts`) and `checkPath`, on the mapped tool. Paths are canonicalised against the workspace root, as `createWorkspace` does.
3. **Protected folders:** `protect: [dataDir]`, `neverBrowse`, and the `hidden` read-deny rules. The engine's own home is denied too, so it cannot rewrite its own config. A write outside the workspace is denied. A read outside it is an Ask, except in Auto (Security to confirm).
4. **Ask rules**, then `needsOk` for the mode. An Ask reaches the person through `askPermission`: the same card and nudges, and no answer by the end of the reply means no.
5. **Allow rules**, then allow.

An unknown tool is judged as `run`. A request whose input cannot be read is denied. Bunny sends its one-line reason back (`describeRule`).

### 3.2 Way one: per-call approval (Codex; Cline if [R2]; Claude Code if allowed)

- Every action reaches `approve()` before it runs. This works on native Windows, where Claude Code has no sandbox at all (F2 §5).
- **Codex:**
  - `approvalPolicy: on-request`;
  - `sandbox: workspace-write`, or `read-only` in Plan mode, as a second wall;
  - `--ignore-user-config` and `--ignore-rules`, with an isolated `CODEX_HOME` (M4);
  - `check_for_update_on_startup = false` (F1 §1, §4).
  - **The Windows sandbox:** Codex's sandbox needs helper executables (`codex-windows-sandbox-setup`, `-service`, `codex-command-runner`), and the elevated mode may need an admin step (F1 §5, UNKNOWN). Bunny never asks for elevation. It uses `unelevated` if that works without admin **[R14]**; otherwise per-call approval alone is the wall, as for Claude Code.
- **Claude Code** (only if the owner allows it, §7):
  - a generated `--settings` file holding Bunny's deny rules (protected folders as `Edit(//path)` and `Read(//path)`);
  - `canUseTool` or `--permission-prompt-tool` answering everything else through `approve()`;
  - its web tools, other MCP servers and subagents turned off;
  - `DISABLE_UPDATES` set (F2 §4).

**If per-call approval cannot be made to cover every tool for an engine, it uses way two or is not offered.**

### 3.3 Way two: a staged copy (Aider; Cline if [R2] fails)

For an engine that applies edits itself, with no per-call hook:

1. **Copy.** Before the turn, Bunny makes a staged copy of the workspace in the chat's engine folder: the `worktrees.js` pattern for a git repo, otherwise a plain copy. The copy **leaves out every path the read-deny rules hide**, and the data folder, so the engine cannot read them even through a repo map. The engine runs with that copy as its `cwd`.
2. **No commands, no git.** The engine is started with its own shell commands and git actions turned off (Aider: `--no-auto-commits`, no `/run`, no shell suggestions **[R6]**). Where they cannot be turned off, that engine is not offered (M2).
3. **Judge every changed path.** At the end of the turn, Bunny diffs the copy against the real folder and judges each changed, added or deleted path with the bridge (§3.1), as a `write_file` or `edit_file`.
   - Denied paths are discarded, and the reply says which and why.
   - An Ask shows one card listing the files, and the person may take all or none. Design to draw a per-file choice.
   - Plan mode keeps nothing.
4. **Apply.** What is allowed is written through the workspace's own write path, so `beforeWrite`, checkpoints and the Changes pane all work as for Bunny's own edits (M7). The staged copy is then removed.

The person's folder only ever changes through Bunny's own write path.

### 3.4 Second walls, for every engine

- An isolated home under `engines\<id>\home\<chat>`, **rewritten at each run start**.
- `safeEnv` plus only the named variables: no provider keys, no `GITHUB_TOKEN`, no paths to the person's home config.
- The CLI's own web and fetch tools are off **[R10]**.
- A command run by a per-call engine can still reach the network, as `run_command` can today. It is judged as a command.

### 3.5 Device levels and the action log

| Who | Choose an engine, download, update or roll back | Chats run on an engine |
|---|---|---|
| Bunny's window | yes: `engine` joins `WINDOW_ONLY_SETTING_KEYS`, `session.engine` joins `WINDOW_ONLY_SESSION_SETTINGS`, and `/api/engines*` joins `WINDOW_ONLY_ROUTES` | yes |
| a device at Everything | no: those routes are window-only, and Everything excludes nothing else on them | yes, if the window chose it. Every engine tool goes to `remote.logAction` as `{kind: 'tool', tool: <mapped name>}`, by name only (R-DF2) |
| a device at Chats | no | no: its chats always use Bunny's engine (`remoteToolBlocked` already refuses it Code-mode tools) |

---

## 4. Download on click, versions, updates, rollback

### 4.1 Licences and terms (checked before any build)

| Engine | Licence | May Bunny download and run it for the person? |
|---|---|---|
| Codex CLI | Apache-2.0 (F1 §3) | Yes. The licence text and notices are shown in About. Trademark terms: UNKNOWN. |
| Aider | **[R15]** (believed Apache-2.0) | waits |
| Cline | **[R15]** (believed Apache-2.0) | waits |
| Claude Code | "All rights reserved" plus Anthropic's Commercial Terms (F2 §3) | Only as the official package, unmodified, with its own sign-in intact, and Bunny never collecting claude.ai credentials (F2 §3). Held, §7. |

### 4.2 Layout (nothing in the installer)

```
%LOCALAPPDATA%\BunnyAI\engines\<id>\<version>\...        one folder per downloaded version (BUNNY_DATA_DIR\engines in tests)
%LOCALAPPDATA%\BunnyAI\engines\<id>\current.json         { version, sha256 } — which version runs
%LOCALAPPDATA%\BunnyAI\engines\<id>\home\<chat>\         isolated homes (M4)
%LOCALAPPDATA%\BunnyAI\engines\<id>\stage\<chat>\        staged copies (3.3), removed after each turn
%LOCALAPPDATA%\BunnyAI\engines\runtimes\<name>-<ver>\    a pinned runtime an engine needs, shared
```

What each engine needs to run:
- **Codex:** the release asset `codex-x86_64-pc-windows-msvc` plus its sandbox helpers (F1 §4).
- **Claude Code:** `claude.exe` from `@anthropic-ai/claude-code-win32-x64`. Node is not needed to run it (F2 §4).
- **Cline:** Node **[R4]**. It runs on Electron's own Node (`ELECTRON_RUN_AS_NODE=1` with `process.execPath`) if its Node version fits; otherwise Bunny downloads a pinned Node runtime.
- **Aider:** Python **[R8]**: a pinned embeddable CPython and a locked wheel set, installed with no network access beyond the pinned files. If a locked offline install is not possible, Aider is not offered.

Settings shows each engine's size on disk, and a **Remove** button that deletes every version, home and staged copy of that engine.

### 4.3 Pins

`src/server/engines/pins.json` ships in every Bunny release. It lists only **tested** versions:

```json
{ "codex": { "version": "0.170.0", "files": [ { "url": "https://github.com/openai/codex/releases/download/rust-v0.170.0/<asset>", "sha256": "…" } ], "schema": "codex-app-server-0.170.0.json" },
  "aider": { "version": "<R16>", "runtime": "python-<R8>", "files": [ … ] },
  "cline": { "version": "<R16>", "runtime": "electron-node | node-<R4>", "files": [ … ] },
  "claude-code": { "held": "owner decision, §7" } }
```

The Codex version is the one Researcher found (F1 §1). The others wait on **[R16]**, and the real sha256 values are computed when a pin is tested.

- A version is **tested** when QA's engine smoke (5.4) has passed for it on an invented profile and its fixtures were recorded from it.
- **Between Bunny releases**, a Bunny GitHub Release may carry an `engines.json` asset in the same shape, read from the feed `updater.js` already trusts (`RELEASES_FEED`). An engine can then move to a newer tested version without a whole Bunny release.
- Whether to offer "latest, untested" is an owner question. Recommendation: no.

### 4.4 Download, update, switch, rollback (window-only routes)

1. `GET /api/engines` returns, for each engine: whether it is downloaded, the running version, the tested version available, the size, and whether a previous version is kept.
2. `POST /api/engines/<id>/download` (also used for an update):
   - fetch over HTTPS from the pinned URLs only, with no redirect off the pinned host;
   - write into `engines\<id>\.staging-<rand>`, with progress shown in Settings and a Cancel button (about 380 MB);
   - verify every file's `sha256`; any mismatch deletes the staging folder and says so;
   - extract with no paths outside the folder and no links;
   - run `<cli> --version` there with `safeEnv`, no network, and a 10 s timeout. It must print the pinned version.
3. **Switch:** rename the staging folder to `engines\<id>\<version>`, then write `current.json` atomically (a temp file, then a rename).
   - Never while a run of that engine is going: the update says "after the current reply".
   - A run that has already started keeps its version.
4. **Keep two:** the previous version is kept, and older ones are removed. A failed download cleans up after itself (the `removeTree` pattern, W6-6).
5. **Rollback:** `POST /api/engines/<id>/rollback` switches back to the previous version.
   - If the current version fails `locate()` at a run start (missing, or its hash changed on disk), the run says so and offers rollback.
   - With no previous version, new chats use Bunny's own engine.
6. **The CLI's own self-update is off** (Codex `check_for_update_on_startup = false`; Claude Code `DISABLE_UPDATES`, F2 §4; Aider and Cline **[R17]**). Only this flow changes what runs.

---

## 5. Tests and the gate

### 5.1 Nothing real in the gate

`fake-engine.mjs` stands in for any profile, selected with `BUNNY_FAKE_ENGINE=<profile>:<script>`:
- it replays a recorded script;
- for a per-call profile it asks `approve()` and waits;
- for a staged profile it edits its staged copy;
- its model calls go through the run's endpoint to the fake upstream.

The gate runs no real CLI, uses no network, and needs no account.

### 5.2 Unit tests (new files)

| File | What it proves |
|---|---|
| `test/engine-events.test.js` | Each adapter's parser, on fixtures recorded from the pinned version (`test/fixtures/engines/<id>/<version>/`, invented profile and fake upstream, nothing secret), gives exactly the expected events. A malformed or over-long line, or an unknown method or event, ends the run. Codex's methods match the pinned schema file. |
| `test/engine-endpoint.test.js` | The listener is on 127.0.0.1 only. It refuses: a wrong Host, any Origin, a missing or wrong token, another run's token, and any request after the run. The model name the CLI sends is ignored. The **Responses ⇄ Chat** translator round-trips text, reasoning, tool calls, tool results, the `developer` role, stop reasons and usage, streaming and not. A request that needs stored state is refused. No key appears in anything the endpoint sends to a CLI. |
| `test/engine-bridge.test.js` | A table: every mode × every rule effect × every mapped tool kind gives the same decision as Bunny's own engine for the same call. Also: protected folders and the engine home are denied; an unknown tool is judged `run`; unreadable input is denied; an unreachable bridge stops the run; no answer by the end of the reply means no. |
| `test/engine-staging.test.js` | The staged copy leaves out hidden and denied paths. Only allowed changes are applied, through the workspace write path and checkpoints. Denied and Plan-mode changes are discarded and named. Deletes are judged too. The copy is removed afterwards. Symlinks in the copy are not followed. |
| `test/engine-store.test.js` | A hash mismatch, an archive path-escape, a redirect off the pinned host, or a wrong `--version` is refused and the staging folder is removed. `current.json` is written atomically. Rollback works. An update waits during a run. Remove deletes everything. A fake registry is used, with no network. |
| `test/engine-device.test.js` | Over real HTTP, with the remote-access harness: a Chats device's Code-mode chat runs on Bunny's engine. No device reaches `/api/engines*` or `engine`. An Everything device's engine tools are logged by name only. |
| `test/engine-env.test.js` | The spawned environment is `safeEnv` plus the named variables only. The home is rewritten at each start. An incognito home is removed. The token never appears in the spawn arguments. |

### 5.3 End-to-end (Playwright, invented profile, fake engine)

- **Settings → Engines:** download with progress and Cancel, update, rollback, Remove, and the size on disk. Both themes, at phone and desktop widths (O3, O8).
- **A Code-mode chat on a per-call fake engine:** the steps, Verbose results, the Changes pane and Stop work; an Ask card is answered; Plan mode refuses.
- **A Code-mode chat on a staged fake engine:** a denied file is named and not written; the Ask card lists the files.
- Switching engine applies to new chats only. Help text and pictures ship with the screen (O7).

### 5.4 Gate changes

1. **New step, "engine pins"** (`scripts/engine-pins.mjs`, with its own test): `pins.json` parses; each entry has an https URL and a sha256 for every file; Codex's schema file is present for its pin; every licence named is shown in About.
2. **The dependency audit cannot see downloaded engines.** The pins step stands in for it. Security decides whether to add a known-CVE check by version.
3. **The secret scan already covers the fixtures.** Recording uses only the invented profile and the fake upstream.
4. **Unit and e2e run as today.** GATE-WHY (5c32755) names the cause if an engine test hangs.
5. **Outside the gate:** `scripts/engine-smoke.mjs`, run by QA before any pin change. It downloads the real pinned engine into an invented profile and runs it against the fake upstream through the real endpoint. It records fresh fixtures and fails if the event shape changed.

---

## 6. Build order (each a board row; HIGH rows keep an independent review and Security's sign-off)

1. Researcher's Aider and Cline facts (R1–R17), then this spec is revised and an ADR filed.
2. Security's requirements. Design's drawing. The owner's go.
3. `events.js`, `endpoint.js` with the **Responses translator**, `bridge.js` and `staging.js`, each with tests, on the fake engine.
4. The Codex adapter (Responses, app-server, per-call).
5. The Cline adapter.
6. The Aider adapter, staged.
7. `store.js`, the download, update and rollback routes, and the Settings screens.
8. The pins gate step, `engine-smoke.mjs`, help text and pictures.

Claude Code is held until the owner decides (§7).

---

## 7. Claude Code: with the owner

The owner's word 3 ("none work on accounts") and Researcher's findings (F2 §2, §3, §6) leave two routes. **Neither is built until the owner chooses.**

**A. The owner's own Anthropic account, Claude models only** (the Chief of Staff's earlier relay).
- It is installed on click from the official package, unmodified (F2 §3).
- The owner signs in through Claude Code's own flow, in a visible terminal started with the isolated home. Bunny never reads, copies or stores those credentials, and the bridge denies reading that home.
- Models are the owner's Anthropic ones, not Bunny's: `models: 'own-account'`, so the endpoint is not used.
- **This conflicts with word 3 and with R4 (free only),** since it needs a paid Anthropic plan (F2 §6). It is offered only if the owner says so in words.

**B. The gateway route: Claude Code on Bunny's models through `/v1/messages`.**
- No account is needed (F2 §2).
- But Anthropic does not support non-Claude models this way, documented failures exist (thinking and beta-field 400s, no auto-compaction), and the terms question in F2 §3 (section D.4) is the owner's legal call.
- It also needs a second translator, Messages ⇄ Chat.

**Recommendation:** ship v0.1.14 with Codex, Cline and Aider, which fit word 3, and leave Claude Code off until the owner picks A or B, in words.

---

## 8. Open facts

**Confirmed by Researcher (F):**
- F1 is Codex (e462903 §1–§6):
  - app-server JSON-RPC with `requestApproval`;
  - `wire_api = "responses"` only;
  - Apache-2.0;
  - no OpenAI account with a custom provider;
  - about 386 MB plus helpers;
  - `--ignore-user-config`, `--ignore-rules`, `check_for_update_on_startup`.
- F2 is Claude Code (e462903 §1–§6):
  - stream-json and `canUseTool` / permission-prompt-tool;
  - Messages API only;
  - all rights reserved, with preinstall conditions;
  - a paid Anthropic account;
  - no sandbox on native Windows;
  - `DISABLE_UPDATES`;
  - 379 MB.

**Waiting on Researcher (R):**

| Mark | Fact | If it comes back wrong |
|---|---|---|
| R1 | Cline's headless output: JSON lines or JSON-RPC | text transport, coarser steps |
| R2 | Cline's headless mode carries per-call approvals for every tool | Cline uses the staged copy (3.3) |
| R3 | Cline accepts an OpenAI-compatible base URL and key with no account | Cline not offered (M5) |
| R4 | Cline's runtime and Node version, and its size | Changes 4.2 (a pinned Node) |
| R5 | Aider has a structured output mode | text transport |
| R6 | Aider can run with shell commands, `/run` and git commits off, and its edits all land in `cwd` | Aider not offered (M2) |
| R7 | Aider accepts an OpenAI-compatible base URL and key (litellm) with no account | Aider not offered (M5) |
| R8 | Aider installs offline from a pinned Python and a locked wheel set | Aider not offered |
| R9 | Aider and Cline have a structured "ask the person" event | questions shown as text |
| R10 | Tool names per CLI, and that their web and fetch tools can be turned off | mapping changes; if web cannot be turned off, Security decides |
| R11 | Aider and Cline can resume their own session headless | the transcript fallback (1.5) |
| R12 | Codex can run with no stored Responses state (`--ephemeral` or the like) | the translator keeps per-run state in memory |
| R13 | Which of Bunny's providers serve `/v1/responses` natively | always translate |
| R14 | Codex's Windows sandbox runs `unelevated` with no admin step | per-call approval alone (as Claude Code) |
| R15 | Aider and Cline licences | not offered until known |
| R16 | Aider and Cline versions to pin | |
| R17 | Aider and Cline self-update and telemetry can be turned off | Security decides (M5) |

## 9. Questions for the owner (one at a time, with the drawing, O12)

1. Claude Code: route A (your own Anthropic account, paid), route B (Bunny's models, unsupported by Anthropic), or leave it off for now? Recommendation: off for v0.1.14, decided later (§7).
2. Updates: tested versions only, or also "latest, untested"? Recommendation: tested only.
3. Engines for Code-mode chats only, with Chat mode always on Bunny's own engine? Recommendation: yes.
