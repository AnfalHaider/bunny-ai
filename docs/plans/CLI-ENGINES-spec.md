# CLI-ENGINES: architecture spec (draft)

Tech Lead, 2026-11-18. Written for the v0.1.14 headline in `docs/plans/2026-11-18-v0.1.14-wishlist.md` (af8e3da).

- Owner's words: Claude Code and Codex CLI are selectable in Settings as engines behind Bunny's interface. They use the models Bunny provides, ship bundled, and can be updated from inside Bunny. Bunny's own engine stays the default.
- Status: **draft**. Risk: **HIGH**. It adds a new execution engine, a permission bridge, bundled third-party code and a local model endpoint.
- Order: Security sets the requirements and Design draws Settings and the update screens. The owner's go is asked with the drawing. Then Builder builds.
- An ADR is filed once Researcher's facts settle the open choices.

**How to read the assumption marks.** Anything marked **[R*n*]** waits on Researcher's report, `docs/research/2026-11-18-cli-engines.md`, which had not landed when this was written. If a fact comes back different, the section that names it is revised before anything is built. The rule throughout: **an engine whose facts fail a must below is not offered.** Bunny does not ship a weaker version of the rule to fit a CLI.

Code references are to main at 43ced06 (v0.1.13).

---

## 0. Scope and the musts

| # | Must | Why |
|---|---|---|
| M1 | Bunny's own engine stays the default. Choosing an engine is a window-only setting. | Owner's words; a device must not switch what runs on the PC. |
| M2 | Every action the CLI takes on the PC (a command, a file write or edit, a file read outside the folder, a network fetch, an MCP call) is decided by Bunny **before** it runs, using the same rules and modes as Bunny's engine. | Deny/Ask/Allow, Plan mode, protected folders and device levels must hold. |
| M3 | The CLI never sees a provider key or a sign-in token. It sees only a per-run token for Bunny's local endpoint. | Keys never leave the DPAPI store or Bunny's process (AGENTS.md). |
| M4 | The CLI runs with its **own isolated config home** under Bunny's data folder. It never reads the person's own `~/.claude`, `~/.codex`, global MCP servers, hooks or plugins. | Otherwise the person's global settings would run tools Bunny never judged. |
| M5 | No paid account. No vendor sign-in. No telemetry or auto-update phoning home from the bundled CLI. | R4 (free only); updates go through Bunny's pinned flow only. |
| M6 | Fail closed. If the permission bridge is unreachable, an event cannot be parsed, or the CLI exits oddly, the run stops and says so. It never continues unjudged. | |

Out of scope for v0.1.14: Cursor, Cline and Aider (the owner's later list); Chat-mode chats (§1.4); helper agents through an engine.

---

## 1. The engine adapter

### 1.1 Where it lives

`src/server/engines/`:
- `index.js` (registry);
- `claude-code.js` and `codex.js` (adapters);
- `events.js` (the shared event union and validators);
- `bridge.js` (the permission bridge, §3);
- `endpoint.js` (the local model endpoint, §2);
- `store.js` (bundled and installed versions, §4);
- `fake-engine.mjs` (a scripted stand-in CLI for tests, §5).

### 1.2 The interface

```js
/** One adapter per CLI. Pure Node; no Electron. */
export const engine = {
  id: 'claude-code' | 'codex',
  label: 'Claude Code' | 'Codex CLI',
  /** Where the executable is, its version, and whether this build can run it ({ ok, version, path } | { ok: false, reason }). */
  async locate(store) {},
  /**
   * Start one turn. Returns a run whose `events` is an async iterator of EngineEvent (1.3).
   * Never throws for a CLI failure: it yields { type: 'error' } and ends.
   */
  start({
    runId,          // randomUUID, one per Bunny reply
    cwd,            // the workspace root (createWorkspace's root), never the data folder
    prompt,         // the person's message (text; attachments as file paths inside cwd only)
    resume,         // the CLI's own session id kept on the Bunny chat (1.5), or null
    model,          // a label only: the endpoint decides what really answers (2.3)
    mode,           // 'plan' | 'ask' | 'accept' | 'auto' (Bunny's permission mode)
    endpoint,       // { baseUrl, token } for this run (2)
    bridge,         // { url, token } for this run (3), or the adapter's in-process hook
    home,           // the isolated config folder for this run (M4)
    env,            // safeEnv() plus only what the adapter adds (never process.env as a whole)
    signal,         // AbortSignal: Stop in Bunny's window, or the reply's connection closing
  }) { return { events, stop } },
};
```

- The CLI is spawned through `safeExec` (absolute path, `safeEnv`, `windowsHide`) with `stdio: ['pipe', 'pipe', 'pipe']`.
- It is killed as a whole tree on `stop()`. This is the RUN-1 Windows child-kill lesson: `taskkill /T /F` on Windows.
- A run that prints nothing for the wait limit (`waitLimits`) is ended the way `unit-tests.mjs` ends a HUNG run, and says so.

### 1.3 Events (the shared union, `events.js`)

| EngineEvent | Fields | Bunny's SSE event (`send` in the message route, app.js ~1960) | Saved in the chat |
|---|---|---|---|
| `text` | `delta` | `delta` | Joined into the assistant message, as Bunny's engine does. |
| `thinking` | `delta` | `thinking` | As today (thinking kept or not, per setting). |
| `tool-start` | `callId, name, input` | `tool` `{ status: 'running' }` | A step, opened. |
| `tool-end` | `callId, ok, output` | `tool` `{ status: 'done' \| 'failed', result }` | A step through `keepForModel`: short `result` (1 200), `modelResult` (8 000, never secret-like, never incognito). |
| `permission` | `requestId, name, input` | Decided by the bridge (§3). Only an Ask reaches `send('permission')` via `askPermission`. | Nothing until answered; the answer is a step note. |
| `question` | `requestId, text, options` | `question` (Bunny's existing card), only if the CLI has a structured "ask the user" event **[R1]** | As today. |
| `edit` | `path, before?, after?` | Feeds the Changes pane (`changesFor`) and checkpoints, as `write_file` / `edit_file` do. | As today. |
| `usage` | `inputTokens, outputTokens` | None; added to `usage.js` against the real provider and model the endpoint used (2.3). | |
| `session` | `engineSessionId` | None | `session.engine = { id, sessionId, version }` (1.5). |
| `done` | `stopReason` | `done` | |
| `error` | `code, message` | `error` | |

**Tool names.** Each adapter maps its CLI's tool names onto Bunny's step vocabulary: a shell tool shows as `run_command`, read/write/edit tools as `read_file` / `write_file` / `edit_file`, search tools as `search_files` / `find_files`. The step list, the Verbose view and the action log then read the same whatever the engine. The CLI's own name rides along as `engineTool` for Activity. The exact names per CLI are **[R2]**. An unknown tool name is shown under its own name and judged as the riskiest kind (`run`) by the bridge (§3.2).

**Parsing.** Each adapter reads the CLI's structured stream: Claude Code `--output-format stream-json` **[R3]**, and Codex `exec --json` or its app-server protocol **[R4]**.
- One JSON object per line, at most 1 MB a line.
- A line that is not valid JSON, or does not validate, ends the run with `error` (M6). It is not skipped.

### 1.4 Where it plugs into app.js

The message route (`POST /api/sessions/<id>/messages`, the `streamChat` loop at app.js ~3160) gains one branch before the provider loop:

```
engineId = chat.engine ?? settings.engine ?? 'bunny'
if engineId !== 'bunny' && workMode === 'code' && workspace && !req.bunnyRemote:
    return runEngineTurn(...)
```

`runEngineTurn` reuses what is already there:
- `send`;
- `replyStatus`;
- `waitNudges`;
- `askPermission`;
- `keepForModel`;
- `stepsTaken`;
- checkpoints;
- `noteRemoteMode`;
- `remote.logAction`;
- the hooks (`runHooks` UserPromptSubmit / Stop).

The streaming page, the transcript, Stop, Verbose, Changes and the sidebar status labels then need **no new event types**.

Choices made here, for Design and Security to confirm:
- **Code mode with a folder only.** Chat mode, a chat with no folder, scheduled tasks and the Quick ask bar always use Bunny's engine. The CLIs are coding agents; Bunny's Chat-mode tools (web, connectors, artifacts, memory, Google, GitHub) are Bunny's own.
- **A Chats-level device never runs an engine.** Its chats use Bunny's engine (§3.5).
- **One engine per chat.** The engine is fixed when the chat's first message is sent (`session.engine`). Switching engine in Settings applies to new chats. Opening an existing chat keeps its engine. Changing it means starting a new chat (Design to draw how that is said).
- **Bunny's own tools are not offered to the CLI in v0.1.14.** That covers memory, artifacts, the browser pane, computer use, connectors and helpers. A later step could offer them as a Bunny MCP server behind the same bridge. Not now: it doubles the surface Security must judge.

### 1.5 Chat continuity

- `session.engine = { id, sessionId, version }` is saved on the chat. The next message resumes the CLI's own session: Claude Code `--resume <id>` **[R5]**, Codex `exec resume <id>` **[R5]**.
- The CLI's session files live in the run's isolated home (M4), inside Bunny's data folder. Deleting the chat deletes them.
- An incognito chat uses a temporary home that is removed when the reply ends, and cannot be resumed.
- Bunny's own transcript stays the record the person reads. If the CLI's session cannot be resumed (another version, files gone), Bunny starts a new CLI session. It sends Bunny's transcript, cut by `shrinkConversation`, as the first prompt and says so in one line.

---

## 2. Bunny's local model endpoint

### 2.1 Shape

`endpoint.js` makes **one listener per run**, started by `runEngineTurn` and closed when the run ends:
- `127.0.0.1` on port 0 (the OS picks it);
- never the LAN address;
- never the main server's port.

It answers only:
- `POST /v1/messages`: Anthropic Messages, streaming and not, with tools. This is for Claude Code **[R6]**.
- `POST /v1/chat/completions`: OpenAI Chat Completions, streaming, with tools.
- `POST /v1/responses`: the OpenAI Responses API. Included if Codex needs it for custom providers **[R7]**. This is the largest unknown: if Codex speaks only Responses to a custom provider, the Responses↔Chat translation is its own work item.
- `GET /v1/models`: one entry, the chat's model label.

Anything else returns 404.

### 2.2 Who may call it

Every request must pass every check below, or it gets a 403 with no body detail:

1. The `Host` is exactly `127.0.0.1:<port>`.
2. **No `Origin` header.** A browser always sends one on a cross-site request; the CLI does not. This stops a web page on the PC (the S-1 lesson).
3. The token is in `x-api-key`, or in `Authorization: Bearer`, and equals the run's token. The token is `randomBytes(32)` and is compared with `timingSafeEqual`.
4. The request body is at most `MAX_MESSAGE_BODY`. Only these JSON content types are accepted.

Further rules:
- The token reaches the CLI only through its environment: `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` **[R6]**; for Codex, a custom `model_providers` entry in the isolated `config.toml`, with `env_key` naming a variable Bunny sets **[R7]**. It is never on the command line, where other processes could read it (O6).
- The token dies with the run. A leaked token is worth one reply's model calls, on this PC only.
- No CORS headers, ever. Responses carry `cache-control: no-store`.

### 2.3 Routing to the owner's providers

- The endpoint **ignores the model name the CLI sends**. It answers with the provider and model the Bunny chat has chosen: the chip, or Auto through `providerOrder` and the "Try another model when yours is busy" fallback.
- The keys are read through the existing registry (`createProviderRegistry`, `secretStore`) inside Bunny's process, and the call goes out through `streamChat`'s fetch path. So `waitLimits`, `firstReplyWaitSeconds`, `refusesTools`, `refusesThinking` and the fake upstream (`BUNNY_FAKE_UPSTREAM`) all hold unchanged.
- Translation lives in `endpoint.js`, as pure functions with fixtures:
  - Anthropic Messages ⇄ OpenAI Chat: `tool_use` / `tool_result` ⇄ `tool_calls` / `role: tool`, `system` ⇄ system message, `thinking` blocks, and `stop_reason` ⇄ `finish_reason`;
  - streaming events: `message_start` / `content_block_*` / `message_delta` ⇄ `chat.completion.chunk`.
- A provider that already speaks the CLI's format natively may be passed through after the same checks (Anthropic's own API for Claude Code; an OpenAI-compatible API for Codex Chat) **[R8]**.
- Usage is counted against the real provider and model, not the CLI's label.
- A model that refuses tools fails the run with Bunny's existing "this model can't use tools" message. These CLIs cannot work without tools.

### 2.4 The local-network-down case

The owner's rule from 2026-11-16 holds: degrade gracefully only when the local network is down. Auto picks a local model (Ollama) if one is set up. Otherwise the run fails with Bunny's offline message. The CLI is never pointed at a vendor URL.

---

## 3. Permissions: one judge, Bunny

### 3.1 The bridge

Every action the CLI wants to take goes to Bunny first. How each CLI hands it over is **[R9]**:

- **Claude Code.** Preferred: `--permission-prompt-tool` naming a tool on a Bunny MCP server, or a `PreToolUse` hook command in the isolated settings that calls the bridge and blocks on the answer. Either way, the isolated `settings.json` sets `permissions.defaultMode` to the strictest mode, so nothing runs without the prompt tool's answer. It also disables `WebFetch` / `WebSearch`, MCP servers other than Bunny's, and subagents **[R9]**.
- **Codex.** Its approval policy is "ask for everything" (`on-request` / `untrusted`), and its sandbox is `workspace-write` with network off, or `read-only` in Plan mode. Each approval request on the JSON or app-server channel goes to the bridge, and Bunny's answer is written back **[R9]**.

The bridge is `127.0.0.1`, has a per-run token, and has the same Host, Origin and token checks as §2.2. It can also be the adapter's stdin channel, if the CLI's protocol carries approvals in-band: preferred, since there is no second listener.

**If an adapter cannot route every action through the bridge before it runs, that engine is not offered (M2).**

### 3.2 What the bridge decides

It calls the **same functions Bunny's engine calls**, in the same order (app.js ~2083–2100):

1. **Plan mode** refuses edits, commands, builds and sends: `planRefuses`. The CLI's own read-only or plan mode is also set, as a second wall.
2. **Deny rules**: `checkToolCall` / `checkCommand` / `checkPath` from `permissionRules.js` on the mapped tool (1.3).
   - A shell command is judged by `commandParts` (quotes respected; `$( )`, backticks and redirection taken into account).
   - A path is canonicalised against the workspace root, the way `createWorkspace` does it.
3. **Protected folders**: the workspace's `protect: [dataDir]`, `neverBrowse`, and the `hidden` read-deny rules.
   - A path outside the workspace is denied for writes, and for reads goes to Ask in every mode but Auto (Security to confirm).
   - The data folder is denied always. So is the engine's own isolated home, so the CLI cannot rewrite its own permission settings.
4. **Ask rules**, then `needsOk` for the mode: Manual asks edits and runs, Accept asks runs, and Auto asks only `asksInAuto`. An Ask reaches the person through `askPermission`: the same card, the same nudges, and "no answer when the reply ends" means no.
5. **Allow rules**, then allow.

Two rules for unknowns:
- An unknown or unmappable tool is judged as `run`.
- A tool the bridge cannot read the input of is **denied** (M6).

The answer goes back to the CLI as allow or deny with Bunny's one-line reason (`describeRule`), so the model sees why.

### 3.3 Second walls (defence in depth)

- **cwd** is the workspace root. A copy-folder chat (`folder.copy`) runs in the copy.
- The **isolated home** (M4) holds only what Bunny wrote: settings with deny rules for the data folder and the home itself, and no MCP servers but Bunny's bridge, if that is the route. It is rewritten at every run start, so a CLI edit to it never survives a run.
- **Environment.** `safeEnv` (the W29-1 pattern) plus the endpoint variables and telemetry/update-off variables **[R10]**. Nothing else from `process.env`: no `GITHUB_TOKEN`, no provider keys.
- **Network.** The CLI's own web tools are off (3.1). Commands the CLI runs can still reach the network, the same as `run_command` today; the rules judge them as commands.

### 3.4 The action log and checkpoints

- A tool run by an Everything-level device's engine chat is written to `remote.logAction` as `{ kind: 'tool', tool: '<mapped name>' }`, exactly as R-DF2 logs Bunny's tools: name only, never arguments.
- Edits feed checkpoints and the Changes pane through the `edit` event. "Undo changes" works the same for an engine chat.

### 3.5 Device levels

| Who | May choose the engine | Chats run on an engine |
|---|---|---|
| Bunny's window | Yes. `engine` joins `WINDOW_ONLY_SETTING_KEYS`, and `session.engine` joins `WINDOW_ONLY_SESSION_SETTINGS`. | Yes |
| Device at Everything | No: the setting is window-only, and `/api/settings` PUT with `engine` is refused. | Yes, if the window chose it. Logged (3.4). An Auto chat goes back to Ask when the device signs out (as today). |
| Device at Chats | No | **No.** Its chats always use Bunny's engine. The engine needs Code mode and `run_command`, which `remoteToolBlocked` already refuses a Chats device. |

---

## 4. Bundled CLIs: where they live, pinning, updates, rollback

### 4.1 Licence gate (first)

- **Codex CLI** is open source (Apache-2.0) **[R11]**. Bundling is allowed with its licence and NOTICE shipped, listed in About next to the fonts.
- **Claude Code**: whether it may be redistributed inside another app is **[R12]**. If the terms do not allow it, Claude Code is **not bundled**. Bunny downloads the official package on the owner's click, through the same verified pipeline as an update (4.4), into the same folder layout. The owner's wish "bundled" then reads as "installed and updated from inside Bunny"; that change is put to the owner with the drawing.
- Also checked before anything is built: whether either CLI may be pointed at a non-vendor model endpoint under its terms **[R12]**, and that neither needs a paid account or vendor sign-in when its base URL is Bunny's (M5) **[R13]**.

### 4.2 Layout

```
<app>/resources/engines/<id>/<version>/...                  bundled with the installer (electron-builder extraResources; never inside app.asar)
%LOCALAPPDATA%\BunnyAI\engines\<id>\<version>\...           installed by an in-app update (BUNNY_DATA_DIR\engines in tests)
%LOCALAPPDATA%\BunnyAI\engines\<id>\current.json            { version, source: 'bundled' | 'installed', sha256 } — which one runs
%LOCALAPPDATA%\BunnyAI\engines\<id>\home\<chat>\            the isolated config homes (M4, 1.5)
```

- How each CLI runs is **[R14]**. Codex ships native binaries per platform. Claude Code is a Node package, or now a native build. A Node package runs on Electron's own Node (`ELECTRON_RUN_AS_NODE=1` with `process.execPath`) rather than a second bundled Node, if it supports that Node version.
- The installer size cost is measured and put beside the drawing.

### 4.3 Pins

`src/server/engines/pins.json` ships in every Bunny release. It is the list of **tested** versions:

```json
{ "codex": { "version": "x.y.z", "files": { "win32-x64": { "url": "https://github.com/openai/codex/releases/download/...", "sha256": "..." } }, "licence": "Apache-2.0" },
  "claude-code": { "version": "x.y.z", "files": { "npm": { "url": "https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-x.y.z.tgz", "integrity": "sha512-...", "sha256": "..." } }, "licence": "<R12>" } }
```

(The URLs show the shape; the real ones are **[R15]**.)

- A version is tested when the adapter's fixture tests were recorded against it (§5.2) and QA's engine smoke passed on an invented profile.
- **Updates between Bunny releases.** Each Bunny GitHub Release may carry an `engines.json` asset with the same shape and newer tested pins. Bunny reads it from the same releases feed `updater.js` already trusts (`RELEASES_FEED`), so a CLI can be updated without a whole Bunny release.
- Whether to also offer "latest, untested" from upstream is **the owner's question**. Recommendation: no, at least for v0.1.14.

### 4.4 Update flow (Settings → Engines; window-only routes)

1. **Check.** `GET /api/engines` lists, per engine:
   - the running version;
   - its source;
   - the tested version available (from the newest `engines.json`, or the bundled pins);
   - whether a previous version is kept.
2. **Update** (`POST /api/engines/<id>/update`, window-only):
   - download over HTTPS from the pinned URL only (no redirects off the pinned host) into `engines\<id>\.staging-<rand>`;
   - verify `sha256`, and npm `integrity` where given; a mismatch deletes the staging folder and says so;
   - extract with no paths outside the folder and no links;
   - run `<cli> --version` there with `safeEnv`, no network and a 10 s timeout. It must print the pinned version.
3. **Switch.** Rename staging to `engines\<id>\<version>`, then write `current.json` atomically (write a temp file, then rename).
   - Never during a run of that engine: the update waits, or says "after the current reply".
   - A run already started keeps the version it started with.
4. **Keep two.** The version before is kept for rollback, and older ones are removed (the `removeTree` pattern, W6-6: a failed install cleans up after itself).
5. **Rollback.** `POST /api/engines/<id>/rollback` switches `current.json` back, also to `bundled`.
   - If the running version fails `locate()` at start (missing, or the hash changed on disk), Bunny falls back to the bundled pin by itself and says so in one line.
   - If even that fails, the engine shows as unavailable and new chats use Bunny's engine.

Two more rules:
- **The CLI's own self-update is off** **[R10]**. Only this flow changes what runs.
- A device, at any level, never reaches these routes. They are window-only, and the `engines` paths are added to `WINDOW_ONLY_ROUTES`.

---

## 5. Tests and the gate

### 5.1 No real CLI, network or account in the gate

`fake-engine.mjs` is a stand-in CLI. It replays a recorded JSONL script and, where the script says so, asks the bridge for permission and waits for the answer. It is selected with `BUNNY_FAKE_ENGINE=<script>`, the way `BUNNY_FAKE_UPSTREAM` stands in for providers. Its model calls go to the run's endpoint, which goes to the fake upstream.

### 5.2 Unit tests (new files)

| File | What it proves |
|---|---|
| `test/engine-events.test.js` | Each adapter's parser on recorded fixture streams (`test/fixtures/engines/<id>/<version>/*.jsonl`, recorded from the real CLIs by QA on an invented profile, with nothing secret in them) produces exactly the expected EngineEvents. A malformed line, an over-long line or an unknown event type ends the run with `error` (M6). The tool-name mapping covers every name seen. |
| `test/engine-endpoint.test.js` | The listener binds 127.0.0.1 only. A wrong Host, any Origin, a missing or wrong token, a token from another run, or a request after the run ended is refused. The model name sent is ignored. The Anthropic⇄OpenAI (and Responses, if [R7]) translation round-trips text, thinking, tool calls and stop reasons, streaming and not. Usage is counted against the real provider. No key appears in anything the endpoint sends to the CLI. |
| `test/engine-bridge.test.js` | A table: every Bunny mode × every rule effect × every mapped tool kind → the decision, compared with what Bunny's own engine decides for the same call (one judge, two callers). Covered cases: Plan mode refuses writes; the data folder and the engine home are denied; a path outside the workspace; an unknown tool is judged `run`; unreadable input is denied; an unreachable bridge stops the run; Ask reaches `askPermission`, and "no answer before the reply ends" is a no. |
| `test/engine-store.test.js` | Pins parse. A hash mismatch is refused and staging is removed. A path-escape in the archive is refused. `current.json` is written atomically. Rollback works, including to bundled. A missing or changed installed version falls back to bundled. An update waits while a run is going. There is no network (a fake registry). |
| `test/engine-device.test.js` | Over real HTTP, with the remote-access harness: a Chats device's Code-mode chat runs on Bunny's engine, never an engine. A device (Everything included) cannot set `engine` or reach `/api/engines*`. An Everything device's engine tools land in the action log by name only. |
| `test/engine-env.test.js` | The spawned environment is `safeEnv` plus the named variables only: no provider key, no `GITHUB_TOKEN`, and no person's home config path. The isolated home is rewritten at every start. The incognito home is removed after the reply. |

### 5.3 End-to-end (Playwright, invented profile, fake engine)

- Settings → Engines shows each engine, its version, Update and Use previous version. Both themes, phone and desktop (O3/O8).
- A Code-mode chat on the fake engine:
  - draws its steps, Verbose results, the Changes pane and the Stop button exactly as Bunny's engine does;
  - shows an Ask card, and answering it continues the run;
  - in Plan mode shows the refusal.
- Switching engine applies to new chats only, and an existing chat keeps its engine.
- Help text and pictures ship with the screen (O7).

### 5.4 Gate changes (`scripts/gate.mjs`)

1. **New step "engine pins".** `pins.json` parses. Every bundled file under `resources/engines` (when present in `dist`) matches its `sha256`. Every bundled engine has its licence text in `src/ui/fonts/licenses`-style `engines/licenses/`, and About lists it. Done as a small script, `scripts/engine-pins.mjs`, with its own test.
2. **The dependency audit does not see bundled CLIs** (they are not npm dependencies of Bunny). The "engine pins" step is their audit stand-in. Security decides whether a known-CVE lookup by version is added **[R16]**.
3. **The secret scan** already covers the fixtures. Fixture recording must use the invented profile and the fake upstream, so no real key can be recorded.
4. **No change to unit or e2e invocation.** The new tests run in the existing suites. GATE-WHY (5c32755) shows the cause when an engine test hangs.
5. **Outside the gate.** `scripts/engine-smoke.mjs` (QA, before each release that changes a pin) runs each real pinned CLI on an invented profile, against the fake upstream through the real endpoint. It records fresh fixtures and fails if the stream shape changed. It needs the network to fetch the pin, which is why it stays outside the gate.

---

## 6. Build order (each a board row; HIGH rows keep an independent review and Security's sign-off)

1. Researcher's facts R1–R16, then this spec revised and an ADR filed.
2. Security's requirements on §2, §3 and §4. Design's drawing (Settings → Engines, the update and rollback states, the per-chat engine line, and the "starts a new chat" wording). The owner's go.
3. `events.js`, `endpoint.js` and `bridge.js` with their tests. No CLI is needed yet; the fake engine is enough.
4. The Codex adapter (open licence, the likelier one to bundle), then the Claude Code adapter.
5. `store.js`, the update and rollback routes, and the Settings screens.
6. The gate's engine pins step, `engine-smoke.mjs`, help text and pictures.

---

## 7. Assumptions waiting on Researcher

| Mark | Assumption | If it comes back wrong |
|---|---|---|
| R1 | Each CLI has a structured "ask the user a question" event in headless mode. | Questions show as plain text in the reply; no card. |
| R2 | The exact tool names each CLI emits, for the mapping. | The mapping table changes; unknowns are judged `run`. |
| R3 | Claude Code has a headless JSON-lines stream (`-p --output-format stream-json`) with tool start and end, text and usage. | Without a structured stream, Claude Code is not offered. |
| R4 | Codex has `exec --json` or an app-server JSON protocol with the same. | Without it, Codex is not offered. |
| R5 | Both can resume their own session by id, headless. | 1.5's fallback (re-send Bunny's transcript) becomes the only path. |
| R6 | Claude Code honours `ANTHROPIC_BASE_URL` + an auth token variable for any Messages-compatible server, with no vendor sign-in. | Claude Code cannot use Bunny's models: not offered (M3, M5). |
| R7 | Codex accepts a custom provider in `config.toml` (`base_url`, `env_key`, `wire_api` = chat or responses). | If it needs Responses only, §2's Responses translation becomes its own row. |
| R8 | Pass-through for native-format providers is safe and worth it. | Always translate. |
| R9 | Each CLI can hand every action to an external judge before it runs: Claude Code's permission prompt tool or PreToolUse hook; Codex's approval requests in the JSON or app-server channel. Their web tools, other MCP servers and subagents can be turned off. | That CLI is not offered (M2). This is the deciding fact. |
| R10 | Telemetry and self-update can be turned off by environment or config. | Security decides whether it is blocking (M5). |
| R11 | Codex CLI is Apache-2.0 and its native binaries may be redistributed. | Install on click instead of bundling (as R12's fallback). |
| R12 | Whether Claude Code may be redistributed, and whether either CLI's terms allow a non-vendor model endpoint. | Claude Code installs on the owner's click instead of bundled. If terms forbid other endpoints, that engine is not offered. |
| R13 | Neither CLI requires a paid account or sign-in when pointed at Bunny's endpoint. | Not offered (R4, free only). |
| R14 | How each CLI is packaged (native binary or Node package; which Node), and its size. | Changes §4.2's layout, and possibly a bundled Node. |
| R15 | The official download URLs and the integrity data each publishes. | Pins carry our own computed sha256 only. |
| R16 | Whether a version-to-CVE lookup exists that the gate can use offline. | Security decides on a manual check at each pin change. |

## 8. Questions for the owner (asked one at a time, with the drawing, O12)

1. If Claude Code may not be bundled (R12): is "installed from inside Bunny on your click, and updated there" acceptable? Recommended: yes.
2. Should updates offer only versions Bunny has tested, or also "latest, untested"? Recommended: tested only.
3. Is the engine for Code-mode chats only, with Chat mode always Bunny's own? Recommended: yes.
