# CLI-ENGINES: architecture spec (draft, revision 7)

Tech Lead, 2026-11-19. Revision 7 replaces 722f16f (revision 6), e38c393 (revision 5), 84e68af (revision 4), bda6b05 (revision 3), d6465bf (revision 2) and 0b6a2f9 (revision 1).

**What revision 7 adds:**
- spike S2 on Codex CLI 0.170.0 (401bd92), and S1's second and third addenda (7b1f864; 2a92e8f and 4b74686: `--disallowedTools`);
- Security's rulings after them (70093c7):
  - **Codex runs in full mode with `approval_policy = "untrusted"` and CE-1.12 to CE-1.17** (§3.2);
  - for Claude Code, **read-Ask paths become `permissions.deny`** (CE-1.9);
- Codex's restricted mode: shell, unified_exec and view_image off, with only `apply_patch`, `request_user_input` and `tool_search` left (§0.2);
- the owner question on Codex full mode: an accepted command can read outside the folder (§9).

**What revision 6 added:**
- spike S1 on Claude Code 2.1.311 (e1e568f, plus the `--restricted` addendum c532469);
- Security's CE-1 ruling after S1 (8369e8e): Claude Code runs in full mode **only** with the layers CE-1.7 to CE-1.11 (§3.2, §3.6);
- Claude Code's restricted fallback uses `--restricted` together with the staged copy (§0.2);
- the stream watchdog (CE-1.10), with its test;
- the S1 spike lines still owed (§6.1).

**What revision 5 added:**
- Security's requirements CE-1 to CE-9 (13478ca), folded in (§3.6);
- the CE-6 gap is closed: an Everything device is refused the engine routes, settings and `session.engine`;
- the hook denies on every path (CE-1);
- tested pins only, with a Security sign-off on every pin change (CE-5).

**What revision 4 added:**
- the owner's word 5, "restricted mode", and what restricted mode is exactly (§0.2);
- Codex and Cline fall back to restricted mode, no longer "not offered";
- the spikes, planned as the first build step (§6.1).

It takes in:
- Researcher's report: e462903, plus its Aider and Cline section 7 at 0e71850 (`docs/research/2026-11-18-cli-engines.md`);
- the owner's decisions, as relayed by the Chief of Staff, including word 4 below (on main at 5d68314).

**What revision 3 changes:**
- each engine has an auth mode, account or local (§7);
- Aider is local only;
- Claude Code in local mode carries a "not supported by Anthropic" note;
- isolated homes are kept per engine and per mode;
- the per-engine fail-closed verdict is in §0.1.

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
4. "ok build all these, i will sign in with anthroic account when required, but now i think we will need this option in settings also, when we enable a CLI, we need to have option infront of all to sign in with accounts or operate locally."

Word 4 is the decision. It supersedes the hold on Claude Code in revision 2, and turns word 3 into a choice per engine: **account** or **local** (§7). Local stays the default where an engine supports it.

5. Asked "How should v0.1.14 offer the engines that can't check with Bunny first? 1. Restricted mode (recommended) 2. Leave them out", the owner typed: "restricted mode". See §0.2.

What follows from them, as the Chief of Staff relayed it:
- **Four engines:** Claude Code, Codex CLI, Cline and Aider. Each is offered only if it passes the fail-closed verdict in §0.1.
- **Each engine has an auth mode** (§7):
  - **account**: the vendor's own sign-in, run visibly by the owner;
  - **local**: Bunny's endpoint and Bunny's models.
  - Aider is local only.
  - Claude Code in local mode carries a plain note: not supported by Anthropic, and it may break after an update.
- **Downloaded on click, never inside the installer.** Each engine is about 380 MB or more. Engines are stored per version, and updated and rolled back from Settings.
  - This replaces "bundled" in word 1. A download from inside Bunny is the owner's "from within the application"; carrying all four in the installer would make it several times larger.

**Assumption marks.**
- **[F*n*]** marks a fact Researcher has confirmed: F1 is Codex, F2 is Claude Code, in e462903. "Report §7a" to "§7d" refers to section 7 of the report at 0e71850.
- **[R*n*]** marks a fact still open. Each is to be settled by a spike against the pinned version.
- If a fact comes back different, the section that names it is revised before it is built.

**The rule throughout:** an engine whose facts fail a must is not offered. Bunny does not weaken a must to fit a CLI.

Code references are to main at 43ced06 (v0.1.13).

---

## 0. The musts

| # | Must |
|---|---|
| M1 | Bunny's own engine stays the default. Choosing an engine is a window-only setting. |
| M2 | Every action an engine takes on the PC is decided by Bunny **before it reaches the person's folder**: a command, a file write, a read outside the folder, a fetch, an MCP call. The same rules and modes apply as for Bunny's own engine. Two ways to meet it (§3): a per-call approval, or a staged copy that Bunny judges before anything is copied back. |
| M3 | An engine never sees one of Bunny's provider keys. In local mode it sees only a per-run token for Bunny's local endpoint. In account mode Bunny never reads, stores or forwards the vendor credential (§7). |
| M4 | An engine runs with its own isolated config home inside Bunny's data folder, **one per engine and per mode** (§4.2). It never reads the person's own `~/.codex`, `~/.aider*`, `~/.cline` or `~/.claude`, or their global or project MCP servers, hooks, rules and settings. |
| M5 | Local mode needs no account and nothing paid (R4). Account mode is the owner's choice per engine (word 4). In either mode there is no telemetry, and no self-update that phones home: updates come only through Bunny's pinned flow (§4). |
| M6 | Fail closed. If the approval channel is unreachable, an event cannot be parsed, or a run ends oddly, the run stops and says why. Nothing goes on unjudged. |
| M7 | Nothing an engine changes is left without a way back. Checkpoints and "Undo changes" work for an engine chat as they do for Bunny's own engine. |

## 0.1 The fail-closed verdict, engine by engine

The question: can Bunny decide **every** action **before** it runs? That means commands, file reads and writes, fetches and MCP calls.

| Engine | Verdict | Why (Researcher's facts at 0e71850) | What must be proven first (a spike against the pinned version, invented profile) |
|---|---|---|---|
| **Claude Code** | **Yes, with five layers** (S1 e1e568f; Security's ruling 8369e8e). S1 (a), (b) and (d) passed. **(c) failed open:** a hook that crashes, exits 1, prints garbage, times out, is killed or has no runtime lets the tool run. So full mode needs CE-1.7 to CE-1.11 (§3.2). The residual is accepted (§3.6) | A `PreToolUse` hook runs before every tool call, including tools Claude Code would allow on its own, such as reads. It calls Bunny's bridge and blocks until Bunny answers. `canUseTool` / `--permission-prompt-tool` answers whatever still asks. Prompts can stay pending indefinitely (§1, §5 of the report). There is no sandbox on native Windows (§5), so the hook **is** the wall. | (a) The hook fires for every built-in tool, MCP tools and subagents, with no exceptions. (b) Settings can be limited to Bunny's own, so a repository's `.claude/settings.json` cannot add allow rules or hooks: `--setting-sources` or its equivalent **[R18]**. If (b) fails, Bunny runs Claude Code in a staged copy without the project's `.claude` folder (§3.3). |
| **Codex CLI** | **Yes, with `untrusted` and six layers** (S2 401bd92; Security 70093c7). `approval_policy = "untrusted"` sends a `requestApproval` for **every** command and **every** patch, with the sandbox on or off, and a decline stops each. `on-request` and `granular` ask for **nothing** once the unelevated sandbox is on, so they are never used. Full mode needs CE-1.12 to CE-1.17 (§3.2). | **Settled by S2.** Still open: the owner's answer on the read residual (§9); a spike line on a project `.codex/rules` `allow` (CE-1.15, §6.1). |
| **Cline** | **Unknown until a spike.** Likely yes, through a hook | `--auto-approve` is true by default. With `--auto-approve false`, the documented enforcement point is a `PreToolUse` hook, and Bunny would supply it in Cline's isolated `--config` folder. How a host answers an approval in `--json` mode is UNKNOWN (report §7c). | (a) With `--auto-approve false`, every tool call passes the hook first, and the hook can block on Bunny's answer. (b) The hook cannot be removed by the agent (its config folder is denied by the bridge, as in §3.1). (c) A custom OpenAI-compatible base URL is settable from the CLI or SDK (UNKNOWN; needed for local mode). If (a) fails, Cline runs only in a staged copy (§3.3). |
| **Aider** | **No.** It has no permission controls and no hook | No structured output and no per-call channel (report §7b). `--yes` confirms everything. Without it, confirmations need a TTY (UNKNOWN). Shell commands run through `/run`, `/test` or confirmed suggestions. | It can be offered only in one of the two shapes below, and only on the owner's say. |

### What it would take for Aider (for the owner)

**Option 1: git-only, edit-only, in the real folder.**
- Aider runs in the person's folder with auto-commits on, shell commands off (`--no-suggest-shell-commands`, no `/run` or `/test`; flags to confirm **[R6]**), analytics off, and no update check.
- Each edit is a git commit, and the Changes pane can undo it.
- **This does not meet M2.** Edits land first and are undone afterwards. Bunny's Deny rules and protected folders are checked only after the change is already on disk.
- Not recommended.

**Option 2: a confined folder, with Bunny reviewing the diff before anything lands.**
- This is §3.3, the staged copy.
- Aider works in a copy of the workspace that **leaves out** every hidden and denied path and the data folder, with shell commands and git off.
- When the turn ends, Bunny diffs the copy and judges every changed, added or deleted path with the same rules. It writes only what is allowed, through its own write path and checkpoints. Ask rules give one card listing the files.
- Plan mode keeps nothing.
- **This meets M2 for writes and for commands** (there are none). The step view is coarse: text, then a list of files changed.
- **What remains:** Bunny cannot stop Aider from **reading a file outside the copy**, for example an absolute path the model names, because Windows gives no sandbox here and Aider has no hook.
  - Mitigations: `--subtree-only` and no `--read` arguments; a check that Aider reads only from the copy is a spike item **[R19]**.
  - If that read path cannot be closed, the Chief of Staff goes back to the owner before Aider ships (§0.2).
- **Recommended**, if Aider is wanted at all.

**Upkeep:** Aider's last release is v0.86.0 (2025-08-09; PyPI 0.86.2, 2026-02-12), so maintenance risk is real. It needs Python 3.10–3.12 through a pinned `uv` (§4.2).

**In short:**
- Claude Code: yes.
- Codex: yes, with `untrusted` and CE-1.12 to CE-1.17 (S2), once the owner has answered §9.
- Cline: probably, after a spike.
- Aider: no, unless it runs confined with Bunny reviewing its changes (option 2), and the owner accepts that out-of-folder reads cannot be blocked.

### 0.2 The owner's answer: restricted mode (word 5)

The Chief of Staff asked: "How should v0.1.14 offer the engines that can't check with Bunny first? 1. Restricted mode (recommended) 2. Leave them out". The owner typed: **"restricted mode"**.

So an engine that fails per-call approval is offered in **restricted mode**. That is option 2 above, the staged copy of §3.3, applied to any engine:

| Engine | Mode it runs in |
|---|---|
| Claude Code | **Full mode** with CE-1.7 to CE-1.11 (§3.2). **Restricted mode** when any layer is missing, or after the watchdog stops a run (CE-1.10). In restricted mode it runs with `--restricted` (no command tools, no WebFetch, file tools confined to the working folders: shown by the S1 addendum against the canary) **and the same `--disallowedTools`** (S1 addendum 3: WebSearch, Agent and Task, Skill, Cron and the worktree tools gone, subagents included), **plus** the staged copy and Bunny's diff review. `--restricted` still allows Write and Edit, so it is **not** a no-writes mode, and the copy and the review stay the judge. No MCP config is passed in restricted mode. |
| Codex CLI | **Full mode** with CE-1.12 to CE-1.17 (§3.2), once the owner has answered §9. **Restricted mode** when any layer is missing, or after the watchdog stops a run (CE-1.17). In restricted mode it runs with `features.shell_tool=false`, `features.unified_exec=false` and `features.view_image=false`, plus everything in CE-1.14 off. That leaves only `apply_patch`, `request_user_input` and `tool_search`. **S2 shows the canary stays closed** (`i-all-off-view-image`), and every patch asks, including ones outside the folder, which are declined. The staged copy and Bunny's diff review still apply. |
| Cline | Full mode if spike S3 shows its hook sees and blocks every tool call. **Restricted mode** if it does not. |
| Aider | **Restricted mode** always. |

**Restricted mode, exactly:**
1. The engine works in a **confined copy** of the workspace. The copy leaves out every hidden and denied path, the data folder, every engine home, and `.claude` / `.codex` / `.cline` folders.
2. The engine's **own shell and command tools are off**, and so are git, web and MCP. A restricted turn runs no commands at all.
   - How to turn them off, per engine: Aider R6; Codex R23; Cline R24.
   - **An engine whose command tools cannot be turned off is not offered even in restricted mode.** A command inside the copy could still reach anything on the PC.
3. When the turn ends, **Bunny reviews the diff**. Every changed, added or deleted path is judged with the same rules as Bunny's own `write_file` and `edit_file` (§3.1). Only what is allowed is written, through Bunny's own write path and checkpoints.
   - Ask rules give one card listing the files.
   - Plan mode keeps nothing.
4. Settings and the chat say plainly that the engine is restricted. Design draws the line, for example: "Restricted: edits files in a copy; Bunny checks each change before it's kept; runs no commands."

**What stays open, per engine:** whether it can read a file **outside** the copy, for example through an absolute path the model names. Windows gives no sandbox that Bunny can count on here. These are R19 (Aider), R23 (Codex) and R24 (Cline).

**The Chief of Staff's condition:** if a spike cannot close the read path for an engine, the Chief of Staff goes back to the owner **before that engine ships**. Until then that engine stays off in the build, behind its own flag.

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
  auth: ['local'] | ['local', 'account'],      // the modes it supports (7); the chat's engine is { id, auth }
  resume: boolean,                             // can it pick up its own session by id (1.5)
  runtime: 'native' | 'node' | 'python',       // what it needs to run (4.2)
};
```

| Engine | transport | approvals | wire (local mode) | auth modes | runtime | Source |
|---|---|---|---|---|---|---|
| Claude Code | `jsonl` (`-p --output-format stream-json --verbose`) | `per-call`: a `PreToolUse` hook on every tool, plus `canUseTool` | `messages` | account (default), local (with the §7 note) | native `claude.exe` | F2; report §7a |
| Codex CLI | `json-rpc` (`codex app-server`) | `per-call`: `untrusted`, with `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` (S2); else `staged`, restricted mode (§0.2) | `responses` | local (default), account (Codex's own login **[R20]**) | native | F1, S2 |
| Cline | `jsonl` (`--json`: `agent_event`, `run_result`, `run_aborted`) | `per-call` via a `PreToolUse` hook with `--auto-approve false`, if the spike holds; else `staged` | `chat` **[R3]** | local (default), account (`cline auth`, the Cline provider) | node (`cline@3.0.74`, **[R4]**) | report §7c |
| Aider | `text` (plain text plus the git diff) | `staged` only (option 2, §0.1) | `chat` (`OPENAI_API_BASE`, `--model openai/<name>`) | **local only** | python 3.12 through `uv` (`aider-chat==0.86.2`) | report §7b |

### 1.3 The run, and its events

```js
start({ runId, cwd, prompt, resume, mode, endpoint, approve, home, env, signal })
  → { events /* AsyncIterable<EngineEvent> */, stop() }
```

- `cwd` is the workspace root, or the staged copy for a `staged` engine (§3.3).
- `approve(request)` resolves to `{ allow, reason }` (§3.2). A `staged` engine never calls it.
- `env` is `safeEnv()` plus only what the adapter names (M3, M4).
- `prompt` never goes on the command line (CE-8). It goes by stdin, the JSON-RPC `turn/start`, or a file in the isolated home.
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

- **json-rpc** (Codex `app-server`). The adapter does the `initialize` / `initialized` handshake, **without** `capabilities.experimentalApi`. Then `thread/start` (cwd, `approvalPolicy: "untrusted"`, sandbox, `ephemeral: true`, the fixed model name), then `turn/start`. It maps the `item/started`, `item/completed`, `item/agentMessage/delta` and `turn/*` notifications.
  - It answers `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` with `accept` or `decline` from `approve()`, or `cancel` on Stop. **Never `acceptForSession`.** `item/permissions/requestApproval` is always declined. The legacy `applyPatchApproval` and `execCommandApproval` are declined if they ever arrive. These names come from S2's pinned schema (`docs/spikes/cli-engines/s2/schema/`).
  - Stop sends `turn/interrupt`.
  - The method names come from `codex app-server generate-json-schema` **for the pinned version**, kept beside the pin (F1 §1; several names are still UNKNOWN there). An unknown method or notification ends the run (M6).
- **jsonl** (Claude Code; Cline, `--json`, report §7c). One JSON object per line, at most 1 MB a line. A line that is not valid JSON, or fails validation, ends the run (M6).
- **text** (Aider: text only, report §7b). No structured stream. The adapter shows Aider's reply as text, and builds the steps from the staged copy's diff when the turn ends (§3.3): one `edit` step per changed file (Aider runs no commands in option 2). The step view is coarser than for a `jsonl` or `json-rpc` engine. Design is to say so on the engine's Settings row.

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
| `POST /v1/chat/completions` | Aider (`OPENAI_API_BASE`, report §7b), Cline **[R3]** | Passed on to the owner's provider through the existing fetch path, after the checks in 2.2. |
| `POST /v1/messages` (+ `/count_tokens`) | Claude Code in **local** mode (§7) | Messages ⇄ Chat translator, forwarding `anthropic-version` and `anthropic-beta`. It sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` and drops `adaptive` thinking and `context_management` that providers reject (F2 §2, the documented 400s). Built after the Responses translator. |

An engine in **account** mode does not use this endpoint at all: it talks to its vendor directly (§7).
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
- **Aider and Cline:** the adapter's OpenAI-compatible base URL plus a key variable (Aider: `OPENAI_API_BASE` and `OPENAI_API_KEY`; Cline **[R3]**).

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
3. **Protected folders:** `protect: [dataDir]`, `neverBrowse`, and the `hidden` read-deny rules. The engine's own home is denied too, so it cannot rewrite its own config. A write outside the workspace is denied. **A read outside it is an Ask in every mode, Auto included (CE-1.6).** The always-Deny list is in §3.6, CE-1.
4. **Ask rules**, then `needsOk` for the mode. An Ask reaches the person through `askPermission`: the same card and nudges, and no answer by the end of the reply means no.
5. **Allow rules**, then allow.

An unknown tool is judged as `run`. A request whose input cannot be read is denied. Bunny sends its one-line reason back (`describeRule`).

### 3.2 Way one: per-call approval (Claude Code; Codex with `untrusted`; Cline if its hook spike holds)

- Every action reaches `approve()` before it runs. This works on native Windows, where Claude Code has no sandbox at all (F2 §5).
- **The hook route (Claude Code, Cline).** The hook is a small Node script that Bunny writes into the engine's isolated home. It calls the bridge on 127.0.0.1 with the run's token, and blocks on the answer. It answers deny (`permissionDecision: "deny"` or exit 2, **never exit 1, which lets the tool run**) on any error, crash, timeout, bad answer or unreachable bridge (M6, CE-1).
  - The home folder is denied to the engine's own tools (§3.1), so the agent cannot edit the hook away.
  - The hook is rewritten at every run start.
- **Codex, full mode.** These are the six layers Security's ruling requires (70093c7). If any one is missing, Codex runs restricted.
  1. **CE-1.12, the policy.**
     - Always `approval_policy = "untrusted"`, never `on-request`, `never` or `granular`, and no `capabilities.experimentalApi`.
     - Bunny answers `accept`, `decline`, or `cancel` on Stop, and **never `acceptForSession`**.
     - `item/permissions/requestApproval` is always declined.
  2. **CE-1.13, what Bunny judges.**
     - `item/commandExecution/requestApproval` is judged as `run_command` on its command text: `checkCommand`, deny rules, Ask in Ask mode, refused in Plan, exactly as Bunny's own engine.
     - `item/fileChange/requestApproval` is judged per path, as `write_file` or `edit_file`, every path canonicalised. A path outside the workspace, or in a protected, hidden, data or engine-home folder, is declined.
     - A request whose input can't be read is declined.
  3. **CE-1.14, tools off in full mode too.**
     - `features.view_image=false`. S2 showed it reads a file **outside the folder with no ask, even under `untrusted`**.
     - `apps`, `plugins`, `remote_plugin`, `plugin_sharing`, `tool_suggest`, `computer_use`, `image_generation`, `goals` and `hooks` off, and `web_search="disabled"`. Without these, S2 saw Codex reach github.com, api.github.com and chatgpt.com.
     - The S2 network check (no connection but Bunny's endpoint) is repeated at every pin change (CE-5.4).
  4. **CE-1.15, configuration.**
     - The isolated `CODEX_HOME/config.toml` is **rewritten at every run start**, with no `trust_level` entry for any project. S2 showed the first run writes `trust_level = "trusted"` there. The project stays untrusted, so its `.codex` config, hooks and exec-policy rules never load.
     - Also: `--ignore-user-config` where available, `check_for_update_on_startup=false`, `analytics.enabled=false`, and `thread/start {ephemeral: true}` (S2: no session file is written; Codex's own state databases stay inside the isolated home).
  5. **CE-1.16, second walls.**
     - `windows.sandbox="unelevated"` with `workspaceWrite`, and `readOnly` in Plan mode. S2: it starts with no admin prompt, and **confines writes, not reads**. It is never elevated (CE-5.6).
     - **A fixed model name per pin.** Codex offers tools by the model name it is given: an unknown name offers no `apply_patch`. So the adapter always sends the name pinned beside the version, for example `gpt-5.5` for 0.170.0, and the local endpoint ignores it and answers with the chat's own model (§2.3).
     - **A tool-list check.** At `thread/start` the adapter checks the offered tools are exactly `exec_command`, `write_stdin`, `apply_patch`, `request_user_input` and `tool_search`. Anything else stops the run.
  6. **CE-1.17, the watchdog** (as CE-1.10). Every `item/started` of type `commandExecution` or `fileChange` must follow an approval request that Bunny accepted for that item. One that doesn't stops the run at once (a tree kill), and restricted mode is offered.

  **The residual (R23 in full mode):** a command Bunny **accepts** can read files outside the folder, because Bunny judges the command text and the sandbox doesn't confine reads. Security accepts it, as it matches Bunny's own `run_command`. Under §0.2 it is the owner's question (§9), and Codex ships in full mode only after the answer is recorded. Until then, Codex ships restricted.

  **The binary** (S2): `codex-x86_64-pc-windows-msvc.exe.zip` from release `rust-v0.170.0`, 215 MB, sha256 `b1634415…a158` (matching the release digest), unpacked to 602 MB, Authenticode `OpenAI OpCo, LLC`. It includes `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`, `codex-exec-server` and `rg.exe`.
- **Claude Code, full mode.** These are the five layers Security's ruling requires (8369e8e). If any one is missing, Claude Code runs restricted.
  1. **CE-1.7, the hook catches what it can.**
     - A `PreToolUse` hook runs on every tool and calls `approve()`. S1 (a): it sees Read, Write, Edit, Bash, PowerShell (only offered with `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`), Glob, Grep, WebFetch, MCP, `Agent`, and each subagent's own calls (with an `agent_id`).
     - The whole script is wrapped, so an unreachable bridge, a bad answer or any exception prints `permissionDecision: "deny"`.
     - S1 (c) showed what it cannot catch: its own crash, being killed, or a missing runtime. Those let the tool run, which is why the next layers exist.
  2. **CE-1.8, the engine's own permissions stay on.**
     - Always `--permission-prompts none` (or a `--permission-prompt-tool` that answers deny).
     - `--setting-sources user`, with an isolated, empty `CLAUDE_CONFIG_DIR`. S1 (b): neither the project's nor the fake home's hostile config and hook loaded.
     - **No `permissions.allow` rule anywhere.**
     - Never `--dangerously-skip-permissions`, `bypassPermissions` or `acceptEdits`.
     - In Plan mode, also `--permission-mode plan`.
     - With the hook dead, the engine itself then refuses writes, commands, fetches, MCP, and reads outside the folder (S1 `e-killed-noprompts` and `e-missing-noprompts`).
  3. **CE-1.9, Bunny's rules are copied into the engine's own settings.** Bunny's `--settings` gets `permissions.deny` for:
     - every Bunny deny rule;
     - every read-deny (hidden) path, the data folder and every engine home;
     - the protected folders;
     - the key folders (CE-1.6).

     - **Each Bunny read-Ask path also goes into `permissions.deny`** (Security 70093c7). S1 addendum 2 (`ce19-ask-hook-allow`) showed that with `--permission-prompts none`, a hook `allow` does **not** pass a `permissions.ask` read.
     - The cost: Claude Code never reads those paths, even when the person would have said yes. The chat says so in one line when one is refused.
     - `--permission-prompt-tool` is **not** used instead until a spike shows two things: that it answers through Bunny's bridge, and that an unreachable or crashed prompt tool means deny.
  4. **CE-1.10, the stream watchdog (M6).**
     - Every `tool_use` id in the stream-json must have a bridge request from the hook, for the same id, **before** its `tool_result`.
     - A `tool_use` that reaches its result with no bridge request means the hook is not working. The adapter stops the run at once (a tree kill, CE-8.2) and marks the reply "stopped: Bunny's check did not run". It offers to continue in restricted mode.
     - The check lives in the jsonl reader (§1.3), and keeps a map of tool_use id to bridge request seen.
  5. **CE-1.11, a long hook timeout.** The hook's timeout in Bunny's settings is set above the longest an Ask card waits, and the bridge answers deny itself before that. Asks wait in the hook. **S1 addendum 2 passed:** with a 300 s timeout, a card answered at 120 s allowed, and Bunny's own deny at its 150 s limit denied.

  **Also, as before:**
  - only Bunny's MCP config, or none (`--strict-mcp-config`);
  - **`--disallowedTools`, in both modes** (S1 addendum 3). It always names `WebSearch Agent Task Skill CronCreate CronDelete CronList EnterWorktree ExitWorktree`.
    - **Proven:** each is absent from `system/init`, a call is refused ("disabled for this session, in subagents as well as here"), and it never reaches the hook.
    - The subagent tool is `Agent` to the hook and `Task` in the tools list, so both names are given.
    - The other agent-control tools are named the same way: `TaskCreate TaskGet TaskList TaskUpdate TaskStop SendMessage ListAgents ScheduleWakeup Workflow ReportFindings Monitor`. S1 didn't try these names, but the mechanism is the same.
  - **A tool-list check, as for Codex (CE-1.16).** At `system/init`, the adapter checks the offered tools against the pin's expected set:
    - full mode: `Read Write Edit Glob Grep NotebookEdit Bash WebFetch ToolSearch`, plus PowerShell only if Bunny turned it on, and Bunny's own MCP tools if any;
    - restricted mode: the same minus `Bash`, `PowerShell` and `WebFetch`.
    - Anything else stops the run, so a renamed or new tool after an update is caught, and the pin's `engine-smoke` run records the set.
  - `DISABLE_UPDATES` / `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and `DISABLE_TELEMETRY` (S1 set-up). S1's proxy check saw no host but the stand-in.
  - **The binary:** `claude-code-win32-x64`, 219 MB, `claude.exe` with sha256 `966f4b2c…0680`, Authenticode `CN="Anthropic, PBC"` (S1), installed with `--ignore-scripts` (CE-5).

**If per-call approval cannot be made to cover every tool for an engine, it runs in restricted mode, way two (owner's word 5, §0.2).**

### 3.3 Way two: restricted mode, a staged copy (Aider always; Codex if S2 fails; Cline if S3 fails; Claude Code if S1 fails; §0.2)

For an engine that applies edits itself, with no per-call hook:

1. **Copy.** Before the turn, Bunny makes a staged copy of the workspace in the chat's engine folder: a plain file copy, with no `.git` and no link back to the real repository (CE-2). The copy **leaves out every path the read-deny rules hide**, the data folder, every engine home, the engine-config folders, and every symlink, junction and reparse point, so the engine cannot read them even through a repo map. The engine runs with that copy as its `cwd`.
2. **No commands, no git.** The engine is started with its own shell commands and git actions turned off (Aider R6, Codex R23, Cline R24). Web and MCP are off too. Where commands cannot be turned off, that engine is not offered, even in restricted mode (M2).
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
| a device at Everything | **no**: refused by `isDeviceRefused` (CE-6, §3.6). Being window-only is not enough, because Everything counts as the window | yes, if the window chose it. Every engine tool goes to `remote.logAction` as `{kind: 'tool', tool: '<engine id>:<mapped name>'}`, by name only (R-DF2, CE-7). An Ask is answered on that device |
| a device at Chats | no | no: its chats always use Bunny's engine (`remoteToolBlocked` already refuses it Code-mode tools) |

---

### 3.6 Security's requirements CE-1 to CE-9 (13478ca), folded in

Security's requirements are `docs/security/2026-11-18-cli-engines-requirements.md` at 13478ca, written against revision 4. They are **binding**. Where they are stricter than the text above, they win. What each one changes here:

| CE | What changes in this spec | Where |
|---|---|---|
| **CE-1** Hook and bridge fail closed | The hook script is one fixed text from Bunny's code. It is started as `process.execPath` with `ELECTRON_RUN_AS_NODE=1` plus the script's absolute path, never a bare `node`. Its sha256 is checked before each run.<br>**On every path it writes `permissionDecision: "deny"` or exits 2. Exit 1, or any other code, lets Claude Code's tool run.** The whole script is wrapped, so a throw, a crash, a bad or empty answer, an unreachable bridge or its own timeout all end in deny.<br>The CLI's hook timeout is set above the longest an Ask card can wait, and the bridge answers deny before it. Asks wait through the CLI's own permission channel (`canUseTool`, `--permission-prompt-tool`, Codex `requestApproval`) wherever there is one, since that channel can stay pending.<br>Every call is judged: no cached decision, and a CLI's "allow always" is never used. Paths are canonicalised (realpath, 8.3 names, junctions, case) before the rules run.<br>**Reads outside the workspace are Ask in every mode, Auto included.** These are always Deny:<br>- the data folder;<br>- every engine home;<br>- `~\.claude`, `~\.codex`, `~\.cline` and `~\.aider*`;<br>- `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker` and `.config\gh`;<br>- `%APPDATA%` and `%LOCALAPPDATA%`. | §3.1 step 3; §3.2 (hook route); spikes S1(c) and S3: crash, runtime missing, killed, bridge closed, garbage answer and timeout must each show a deny |
| **CE-2** Restricted mode | **The copy leaves out** `.git` (no worktree link back), `.aider*`, and every symlink, junction and reparse point (skipped, never followed).<br>**The diff always discards, and names:**<br>- anything under `.git` or an engine-config folder;<br>- alternate data streams (a `:` after the drive);<br>- reserved names, and names ending in a dot or space;<br>- links;<br>- files over the write limit.<br>Renames and file-type changes are judged.<br>**"Runs code later" files are Ask in every mode, Auto included,** marked on the card:<br>- `package.json`;<br>- `.vscode\tasks.json`, `.vscode\settings.json` and `.vscode\launch.json`;<br>- `.github\workflows\*`;<br>- `Makefile`;<br>- `*.ps1`, `*.bat`, `*.cmd`;<br>- `.husky\*` and `.pre-commit-config.yaml`;<br>- `pyproject.toml` and `setup.py`.<br>"Commands off" needs spike evidence, at the fake upstream and in the process list. An engine whose canary read is open ships only with the owner's answer recorded. | §0.2; §3.3 steps 1 and 3 (the staging copy no longer uses the `worktrees.js` pattern for git repos, because the copy has no `.git`); `engine-staging.test.js` |
| **CE-3** Account homes and the person's homes | Bunny never reads, copies, hashes, logs, exports, backs up or searches an account home. It writes only its own config files there, by name.<br>The account home is left out of the secret-scan walk, Activity, export, staging and SEARCH-PC.<br>Sign-in state comes only from the CLI's status command or a run's error (R21).<br>Sign-in and sign-out run the vendor's fixed command, from the pinned binary by absolute path, in a visible terminal, with only the home variable set, started only from the window.<br>Every CLI home variable points at the isolated home explicitly.<br>A local-mode run's environment carries no vendor credential variable, and an account-mode run's environment carries no endpoint token. | §7.1, §7.3; spikes S1 to S4 add a **fake `USERPROFILE`** holding `.claude\settings.json`, `.codex\config.toml` and `.cline` with allow-everything rules and hooks. None of them may load |
| **CE-4** Local endpoint | A request carrying **any `Sec-Fetch-*` header** is refused too, as well as one with an `Origin`. Only the listed paths are answered.<br>Upstream error text passes through `looksSecret`, and no upstream headers are passed on.<br>**An engine run counts against the chat's `replyCaps` token budget**, and reaching it shows the existing `onLimit` card.<br>At most 4 requests at once per run. The listener is closed on Stop, at the run's end and when Bunny quits. | §2.2, §2.3; `engine-endpoint.test.js` |
| **CE-5** Downloads | **Every byte that runs is hash-pinned:**<br>- release assets and helpers;<br>- Claude Code's package, plus its Authenticode check;<br>- Cline's whole npm tree, from a lockfile with `integrity` values, installed with **`--ignore-scripts`**;<br>- `uv`, its Python runtime, and every Aider wheel (`--require-hashes`, wheels only, no source builds).<br>**Redirects:** every hop must be on the pin's own host list, which includes GitHub's asset host.<br>**Unpacking** refuses `..`, absolute paths, drive letters, symlinks and hardlinks, alternate data streams and reserved names, and stops at **2 GB in total**.<br>**Tested pins only.** `engines.json` is read only from Bunny's own releases feed, with a sha256 for each file.<br>**Every pin change is a Security sign-off** (Security reads the vendor's notes and advisories).<br>Self-update, telemetry and "non-essential traffic" are off, checked at network level.<br>**Elevation is never asked for.** | §4.3, §4.4; §9 question 2 is answered; `engine-store.test.js` |
| **CE-6** Devices: **a real gap in revision 4** | Revision 4 made `/api/engines*`, `engine`, `engines.<id>.auth` and `session.engine` "window-only". But **a device at Everything counts as the window for window-only routes** (DEVICE-FULL: `windowOnly()` returns false for `req.bunnyDevice` except `isRemoteAdminPath`, app.js ~226). So revision 4 would have let an Everything device download, sign in or switch engines. **The fix is below this table.** | §3.5 (the device table rewritten); `engine-device.test.js` runs **at Everything** |
| **CE-7** The record | A local engine record is shown in Settings → Engines. It covers download, update, switch, rollback, remove, sign-in, sign-out and auth-mode change. Each entry holds the time, the engine, the old and new versions, the first 12 characters of the sha256, and who (always the window).<br>Device engine tools are logged as `{kind: 'tool', tool: '<engine id>:<mapped name>'}`.<br>Bridge denials are named in the chat's steps with the rule's one-line reason. | §3.5, §4.4; `engines\record.json` in the data folder |
| **CE-8** Starting the process | **The prompt never goes on the command line.** It goes by stdin (stream-json input for Claude Code; `turn/start` for Codex; stdin for Cline and Aider, or `--message-file` in the isolated home). There is no `-p "<prompt>"`.<br>No inherited handles but the pipes. No engine process outlives its run, and Bunny checks for stragglers on quit.<br>Where the engine's web, fetch, MCP or subagent tools cannot be turned off, the bridge judges them as `run`. | §1.3 (`start()`); §3.4 |
| **Rulings after S1 addendum 2 and S2** (70093c7) | **Claude Code, CE-1.9:** read-Ask paths go into `permissions.deny`, and there is no `--permission-prompt-tool` until a spike proves it. **Codex: full mode only with CE-1.12 to CE-1.17:**<br>- `untrusted`, never `acceptForSession`;<br>- commands judged as `run_command`, patches per path;<br>- `view_image` and the plugin and app features off;<br>- `config.toml` rewritten each run, with no `trust_level`;<br>- the unelevated sandbox, a fixed model and a tool-list check;<br>- the watchdog.<br>**Residual:** an accepted command can read outside the folder. Security accepts it; the owner is asked (§9). **Codex restricted:** shell, unified_exec and view_image off. | §0.1, §0.2, §1.3, §3.2; tests in §5 |
| **CE-1 ruling after S1** (8369e8e) | Claude Code may run in full mode **only** with CE-1.7 (the hook catches what it can), CE-1.8 (`--permission-prompts none`, no allow rules, `--setting-sources user`), CE-1.9 (Bunny's rules as `permissions.deny` / `ask`), CE-1.10 (the stream watchdog) and CE-1.11 (a long hook timeout). **Residual, accepted:** when the hook dies, Claude Code can still read workspace files that no Bunny rule covers, until the watchdog stops the run. Nothing can be written, run, fetched or sent to MCP, and nothing outside the folder can be read. `--restricted` is for the restricted fallback only, with the staged copy. **Cline (S3) is held to the same layers**, or it runs restricted. | §0.1, §0.2, §3.2; tests in §5 |
| **CE-9** What Security signs each engine on | The spike evidence for its row; CE-1's failure set all showing deny; the canary unread, or the owner's recorded answer; the fake-home test; the CE-6 test at Everything; and the store tests (hash mismatch, path escape, redirect off-list, `--ignore-scripts`). | §5, §6.1 |

**The CE-6 fix, in code terms.**

1. `src/server/remoteAccess.js` gains `isDeviceRefused(method, path, body)`. It is true for:
   - `isRemoteAdminPath(path)`;
   - any `^/api/engines(/|$)` path;
   - `PUT /api/settings` whose body has `engine` or `engines`;
   - `PATCH /api/sessions/<id>` (and the session-setting route) whose body has `engine`;
   - `POST /api/sessions` whose body has `engine`.
2. It is checked in three places, the same way `isRemoteAdminPath` is today:
   - in `remoteRoute`'s Everything branch, before `route(req, res)`;
   - in `route()`'s belt, for `req.bunnyDevice`;
   - in `windowOnly()`'s `req.bunnyDevice` branch, on the decoded path, as R-DF3 did.
3. A Chats device is already refused by `remotePolicy`. A test proves it anyway.
4. The refusal message is: "Only Bunny's window can change engines."

---

## 4. Download on click, versions, updates, rollback

### 4.1 Licences and terms (checked before any build)

| Engine | Licence | May Bunny download and run it for the person? |
|---|---|---|
| Codex CLI | Apache-2.0 (F1 §3) | Yes. The licence text and notices are shown in About. Trademark terms: UNKNOWN. |
| Aider | Apache-2.0 (report §7b) | Yes. The licence text is shown in About. |
| Cline | Apache-2.0 (report §7c) | Yes. The licence text is shown in About. |
| Claude Code | "All rights reserved" plus Anthropic's Commercial Terms (F2 §3) | Only as the official package (`@anthropic-ai/claude-code-win32-x64`), unmodified, downloaded on the owner's click, with its own sign-in intact. Bunny never collects claude.ai credentials (F2 §3, report §7a). |

### 4.2 Layout (nothing in the installer)

```
%LOCALAPPDATA%\BunnyAI\engines\<id>\<version>\...        one folder per downloaded version (BUNNY_DATA_DIR\engines in tests)
%LOCALAPPDATA%\BunnyAI\engines\<id>\current.json         { version, sha256 } — which version runs
%LOCALAPPDATA%\BunnyAI\engines\<id>\<mode>\shared\       per engine and mode: the account sign-in (written only by the vendor's own login), the pinned config
%LOCALAPPDATA%\BunnyAI\engines\<id>\<mode>\chat\<chat>\  per chat: the CLI's session files (M4, 1.5)
%LOCALAPPDATA%\BunnyAI\engines\<id>\stage\<chat>\        staged copies (3.3), removed after each turn
%LOCALAPPDATA%\BunnyAI\engines\runtimes\<name>-<ver>\    a pinned runtime an engine needs, shared
```

What each engine needs to run:
- **Codex:** the release asset `codex-x86_64-pc-windows-msvc` plus its sandbox helpers (F1 §4).
- **Claude Code:** `claude.exe` from `@anthropic-ai/claude-code-win32-x64`. Node is not needed to run it (F2 §4).
- **Cline:** Node **[R4]**. It runs on Electron's own Node (`ELECTRON_RUN_AS_NODE=1` with `process.execPath`) if its Node version fits; otherwise Bunny downloads a pinned Node runtime.
- **Aider:** Python 3.12 through a downloaded, pinned `uv` (open source): `uv tool install --python 3.12 aider-chat==0.86.2`, with `UV_TOOL_DIR` and `UV_PYTHON_INSTALL_DIR` inside `engines\aider\<version>` (report §7b).
  - The resolved set of packages is locked by hash at pin time **[R8]**.
  - Antivirus and SmartScreen on a freshly downloaded `python.exe` are UNKNOWN: a QA smoke item.

Settings shows each engine's size on disk, and a **Remove** button that deletes every version, home and staged copy of that engine.

### 4.3 Pins

`src/server/engines/pins.json` ships in every Bunny release. It lists only **tested** versions:

```json
{ "codex": { "version": "0.170.0", "files": [ { "url": "https://github.com/openai/codex/releases/download/rust-v0.170.0/<asset>", "sha256": "…" } ], "schema": "codex-app-server-0.170.0.json" },
  "aider": { "version": "0.86.2", "runtime": "uv-<pin> + python-3.12", "lock": "aider-0.86.2.lock (hashes)" },
  "cline": { "version": "3.0.74", "runtime": "electron-node | node-<R4>", "files": [ … ] },
  "claude-code": { "version": "2.1.311", "channel": "stable", "files": [ … ], "signature": "Anthropic, PBC" } }
```

The versions are the ones Researcher found: Codex 0.170.0 (F1 §1); Claude Code's `stable` tag, 2.1.311 (F2 §1); Aider on PyPI and Cline on npm (report §7b, §7c). The real sha256 values are computed when a pin is tested. Claude Code's Authenticode signature, "Anthropic, PBC", is checked as well (F2 §3).

- A version is **tested** when QA's engine smoke (5.4) has passed for it on an invented profile and its fixtures were recorded from it.
- **Between Bunny releases**, a Bunny GitHub Release may carry an `engines.json` asset in the same shape, read from the feed `updater.js` already trusts (`RELEASES_FEED`). An engine can then move to a newer tested version without a whole Bunny release.
- **Tested pins only** (Security, CE-5.4). There is never a "latest, untested" option. **Every pin change is a Security sign-off.**

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
| `test/engine-watchdog.test.js` | **CE-1.10:** the fake engine, with its hook disabled, emits a `tool_use` and then a `tool_result` with no bridge request in between. The run is tree-killed, the reply is marked "stopped: Bunny's check did not run", and restricted mode is offered. With the hook on, a bridge request before each result keeps the run going. A `tool_result` for an unknown id also stops it. |
| `test/engine-claude-args.test.js` | **CE-1.8 and CE-1.9:** the Claude Code adapter's spawn always has `--permission-prompts none` and `--setting-sources user`, and `--disallowedTools` with the nine proven names plus the agent-control names; and never `--dangerously-skip-permissions`, `bypassPermissions`, `acceptEdits`, `--permission-prompt-tool` or a `permissions.allow`. A `system/init` tool list with anything outside the pin's expected set stops the run. In Plan mode it also has `--permission-mode plan`. The generated `--settings` holds a `permissions.deny` for every deny rule, hidden path, data folder, engine home, protected folder, key folder **and read-Ask path**, and **no `permissions.ask`**. In restricted mode it has `--restricted` and no MCP config. |
| `test/engine-codex-args.test.js` | **CE-1.12 to CE-1.16:** `initialize` never sends `experimentalApi`, and `thread/start` always has `approvalPolicy: "untrusted"`, `ephemeral: true` and the pinned model name. The adapter never answers `acceptForSession`, and declines `permissions/requestApproval` and the legacy approvals. The written `config.toml` has every CE-1.14 feature off, `web_search="disabled"`, `analytics.enabled=false`, `check_for_update_on_startup=false` and **no `trust_level`**, and it is rewritten when a run left one there. A tool list with anything beyond the five expected tools stops the run. Restricted mode adds `shell_tool`, `unified_exec` and `view_image` off. A file change outside the workspace or in a protected path is declined. |
| `test/engine-codex-watchdog.test.js` | **CE-1.17:** with the fake engine, an `item/started` of type `commandExecution` or `fileChange` with no accepted approval first is tree-killed, and restricted mode is offered. With an accepted approval first, the run goes on. |
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

### 6.1 Step 1: the spikes (first, before any Bunny code)

**Who:** Builder runs each spike. QA checks the evidence. Tech Lead reads the result against §0.1 and §0.2.

**Rules for every spike:**
- **Nothing enters Bunny's code.** Spike scripts live in `docs/spikes/cli-engines/<id>/` as notes plus a small script. They are not built into the app.
- **An invented profile only** (`BUNNY_DATA_DIR` = a temp folder). The engine's home goes in that temp folder too. The person's `~/.claude`, `~/.codex`, `~/.cline`, `%LOCALAPPDATA%\BunnyAI` and real projects are never touched.
- **A throwaway test folder** holds:
  - a `secret.txt` that a deny rule covers;
  - a `protected/` folder;
  - a project `.claude/settings.json` (or the engine's equivalent) holding an "allow everything" rule and a hook of its own;
  - a canary file **outside** the folder: `<temp>\outside\canary.txt`, holding a unique string.
- **The model** is the fake upstream, where the engine's wire allows (Bunny's endpoint is not built yet), or a scripted model stub that asks for exactly the tool calls under test. Claude Code in account mode needs no model for the hook test: the hook runs before any tool call.
- **One engine pinned version per spike:** the versions in §4.3.
- **Evidence is command plus output (O1).** Each claim is pasted beside the command that shows it. "Passes" means every row in the spike's table shows the expected result.
- **Each spike is time-boxed to one working session.** A spike that cannot show a result within it reports UNKNOWN, and the engine falls back to restricted mode (§0.2).

| Spike | Engine | What it must show | Pass gives | Fail gives |
|---|---|---|---|---|
| **S1: done** (e1e568f, c532469, 7b1f864) | Claude Code 2.1.311 | (a), (b) and (d) passed; **(c) failed open**, so CE-1.7 to CE-1.11 apply.<br>**`--restricted` (addendum 2):**<br>- it removes Bash, PowerShell, Monitor, WebFetch and Workflow;<br>- it keeps Write, Edit, Read, MCP, WebSearch, **Agent (launched even under `--restricted`)**, Skill and the Cron, worktree and Task tools;<br>- Bunny's `--settings` hook and `permissions.deny` still load;<br>- the canary stays unread, a write outside the folder is refused, and only `conhost.exe` starts.<br>**CE-1.9:** a hook allow does not pass an ask-covered read, so those paths go into `permissions.deny`.<br>**CE-1.11:** passed.<br>**`--disallowedTools` (addendum 3, 2a92e8f and 4b74686):** WebSearch, Agent and Task, Skill, CronCreate, CronDelete, CronList, EnterWorktree and ExitWorktree are absent from `system/init`, refused when called (subagents included), and never reach the hook. Nothing is still owed for Claude Code. | | |
| **S1 (as planned)** | Claude Code | (a) A `PreToolUse` hook from Bunny's settings fires **before** every tool: Read, Write, Edit, Bash/PowerShell, Glob, Grep, WebFetch, MCP, and a subagent's tools. A hook that answers deny stops each one (`secret.txt` unread, nothing written). (b) With Bunny's settings source only (R18), the project's `.claude/settings.json` allow rule and hook are **not** loaded. (c) A hook that fails, times out or cannot reach the bridge means deny. (d) An attempt to read `canary.txt` by absolute path hits the hook. | Full mode | Restricted mode (the `.claude` folder is left out of the copy) |
| **S2: done** (401bd92) | Codex CLI 0.170.0 | **(a)** `untrusted` asks for every command and patch; `on-request` and `granular` don't, once the sandbox is on. **(b)** The approval names come from the pinned schema. **(c)** Decline stops each action. **(d) R23:** commands can be turned off, but `view_image` then still reads outside the folder with no ask. With `view_image` off too, the canary is closed. In full mode, an accepted command can read it. **(e)** `ephemeral: true` writes no session file. **(f)** The unelevated sandbox needs no admin prompt, and confines writes only. Hostile configs did not load, but the first run marks the project trusted in `config.toml` (hence CE-1.15). The network was clean only with the plugin and app features off. **Still owed (CE-1.15):** in an untrusted project, a project `.codex/rules` with an `allow` still gets asked for every command. | Full mode with CE-1.12 to CE-1.17, after the owner's answer (§9) | Restricted mode (shell, unified_exec, view_image off) |
| **S2 (as planned)** | Codex CLI |
| **S3** | Cline | (a) With `--auto-approve false`, a Bunny-written `PreToolUse` hook in the isolated `--config` sees **every** tool call (read, write, edit, command, browser, MCP) **before** it runs, and can block until answered. (b) The agent cannot edit or remove the hook (its config folder is outside the workspace). (c) R3: an OpenAI-compatible base URL and key with `cline auth` skipped. (d) R24: command tools can be turned off, and whether `canary.txt` can be read. (e) R4: Node version, Electron's Node, size on disk. | Full mode | Restricted mode, if (d) turns commands off; otherwise not offered |
| **S4** | Aider | (a) R6: with `--no-suggest-shell-commands`, no `/run` or `/test`, `--no-auto-commits`, `--no-git` or the equivalent, analytics off and `--no-check-update`, a `--message` turn runs no command and makes no commit, even when the model asks for one. (b) Behaviour with no TTY and without `--yes`: it must not hang (the wait limit) and must not confirm by itself. (c) **R19:** when the model names `canary.txt` by absolute path, or asks to `/read` or add it, does its content reach the model? Checked at the fake upstream: does the unique string appear in any request? (d) R8: a hash-locked `uv` install of 0.86.2 with Python 3.12 into the temp folder; size, and whether Defender or SmartScreen objects. | Restricted mode, ready to ship | (a) fails: not offered. (c) open: the Chief of Staff goes back to the owner before Aider ships. |

**How a read outside the folder is detected, for every engine (S1 d, S2 d, S3 d, S4 c):**
- The canary's unique string is searched for in every request the model endpoint receives, and in the engine's stdout.
- Seeing it anywhere means the read path is open.
- This is the one check that does not depend on trusting the engine's own reporting.

**After the spikes:**
- Tech Lead revises §0.1 and §0.2 with the results and files the ADR.
- The Chief of Staff takes any open read path (R19, R23, R24) to the owner, one engine at a time.

### 6.2 Then

2. Security's requirements. Design's drawing: Settings → Engines with the per-engine **auth mode** choice, the **restricted** line, sign-in states, the download, update and rollback states, and the local-mode note. The owner's go.
3. `events.js`, `endpoint.js` with the **Responses translator**, `bridge.js` (with the hook script) and `staging.js` (restricted mode), each with tests, on the fake engine.
4. The Claude Code adapter in account mode (the hook route; no translator needed).
5. The Codex adapter: full mode if S2 passed, otherwise restricted.
6. The Cline adapter: full mode if S3 passed, otherwise restricted.
7. The Aider adapter, restricted, behind its flag until R19 is closed or the owner accepts it.
8. The Messages translator, for Claude Code in local mode.
9. `store.js`, the download, update and rollback routes, the sign-in and sign-out flows, and the Settings screens.
10. The pins gate step, `engine-smoke.mjs` (it re-runs the canary check at each pin change), help text and pictures.

---

## 7. Auth modes: account or local (owner's word 4)

Settings → Engines shows, in front of each engine that is turned on, a choice: **Sign in with an account** or **Operate locally**.
- The choice is kept per engine, as `engines.<id>.auth`, and is a window-only setting.
- A chat records the engine and mode it started with: `session.engine = { id, auth, sessionId, version }`.

| Engine | local (Bunny's endpoint and models) | account (the vendor's own sign-in) | Default |
|---|---|---|---|
| Claude Code | `/v1/messages` through the Messages translator, with the plain note below | `claude auth login` in a visible terminal, in a Bunny-owned `CLAUDE_CONFIG_DIR` (report §7a). Claude models on the owner's Anthropic plan. | account |
| Codex CLI | `/v1/responses` through the Responses translator, using `[model_providers.bunny]` with `requires_openai_auth = false` (F1 §6) | Codex's own login, in the account-mode `CODEX_HOME` **[R20]** | local |
| Cline | `/v1/chat/completions`, if a base URL can be set **[R3]** | `cline auth` (the Cline provider or ClinePass), in the account-mode `--config` folder | local |
| Aider | `OPENAI_API_BASE` with `--model openai/<name>` | **not offered**: Aider is local only | local |

### 7.1 Account mode: what Bunny does and does not do

- **Sign-in** is the vendor's own flow, run visibly by the owner. Bunny opens a terminal window with the engine's account-mode home set (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or Cline's `--config` / `--data-dir`) and runs the vendor's login command. Then:
  - the owner completes it in the vendor's browser page;
  - the CLI writes its own credential file inside that home;
  - Bunny shows "Signed in", or "Sign in again" when a run reports an expired login.

  How Bunny reads the sign-in state without reading the credential is **[R21]**: a status command, or else just the run's own error.
- **Bunny never reads, stores, copies, logs or forwards those credentials.** That covers no `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or `setup-token` in Bunny's store (report §7a options 2 and 3 are not used), and no sign-in form of Bunny's own. This is what Anthropic's terms require (report §7a), and it is the same rule for every vendor.
  - The bridge denies the engine's own tools any read of the account home, so the agent cannot read its own credential and print it.
  - The secret scan and the action log never touch that folder.
  - The folder is left out of any export and any staged copy.
- **Sign out** runs the vendor's own logout in that home, then deletes the home. **Remove engine** deletes every home of that engine, both modes.
- **The engine talks to its vendor directly.** Bunny's endpoint is not started, and `ANTHROPIC_BASE_URL` is not set (report §7a). Usage is the vendor's, so Bunny's Usage page shows the run with "billed by <vendor>" and no token cost.
- **Bunny's rules still judge every action.** The permission bridge, the hook, Plan mode, protected folders, device levels, the action log and checkpoints are the same in both modes (§3). Only where the model runs changes.
- **Bunny creates no account.** The owner signs in to an account they already have, through the vendor. A device, at any level, can never start a sign-in or sign-out.

### 7.2 Local mode for Claude Code: the plain note

On the Claude Code row, under "Operate locally", Design places exactly:

> Not supported by Anthropic. Claude Code may stop working with your models after an update.

The note stays visible while local mode is chosen. Facts behind it:
- Anthropic says Claude Code "doesn't support routing Claude Code to non-Claude models through any gateway" (F2 §2).
- Known 400s, and no auto-compaction (F2 §2).
- The pin and rollback (§4.4) are the remedy when an update breaks it.

### 7.3 Isolated homes per engine and per mode

```
engines\<id>\local\shared\         Bunny's pinned config for local mode (model provider = Bunny, hook, deny rules); rewritten at every run start
engines\<id>\account\shared\       the vendor's credential (written only by the vendor's login) + Bunny's pinned config; Bunny rewrites its config files only, never the credential
engines\<id>\<mode>\chat\<chat>\   per-chat session files
```

The CLI is pointed at the mode's `shared` folder for its config and login. Where the CLI allows a separate data folder (Cline `--data-dir`), it is also pointed at the chat folder. Codex and Claude Code keep their sessions under their home, so **[R22]** decides whether the chat folder is a subfolder or a per-chat copy of the config.

- The two modes never share a folder. A local-mode run can never find an account credential, and an account-mode run can never find the local endpoint's settings.
- Incognito chats get a temporary chat folder that is removed after the reply.
- In account mode the credential is the vendor's, so it is not temporary.

---

## 8. Open facts

**Confirmed by Researcher:**
- **F1 is Codex:**
  - app-server JSON-RPC with `requestApproval`;
  - `on-request`, `never` or `{granular}` (`untrusted` unsupported, per the docs; **S2 showed 0.170.0 accepts `untrusted`, and it is the one Bunny uses**);
  - `wire_api = "responses"` only;
  - Apache-2.0;
  - no OpenAI account with a custom provider;
  - about 386 MB plus helpers.
- **F2 is Claude Code:**
  - stream-json;
  - `canUseTool`, permission-prompt-tool and the `PreToolUse` / `PermissionRequest` hooks;
  - Messages only;
  - all rights reserved, with preinstall conditions;
  - no sandbox on native Windows;
  - `DISABLE_UPDATES`;
  - 379 MB;
  - credentials in `CLAUDE_CONFIG_DIR` (report §7a).
- **Aider** (report §7b):
  - Apache-2.0;
  - text only, no permission controls;
  - `OPENAI_API_BASE`;
  - Python 3.10–3.12 through `uv`;
  - v0.86.0 / PyPI 0.86.2.
- **Cline** (report §7c):
  - Apache-2.0;
  - `cline` 3.0.74 with `--json` lines;
  - auto-approve on by default;
  - `PreToolUse` hook;
  - `--config` and `--data-dir`.

**Still open (each settled by a spike, §6 step 1):**

| Mark | Fact | If it comes back wrong |
|---|---|---|
| R3 | Cline: an OpenAI-compatible base URL and key from the CLI or SDK, with `cline auth` skippable | Cline is account mode only, or not offered in local mode |
| R4 | Cline: its Node version, whether it runs on Electron's Node, Windows support, and its size | A pinned Node download (4.2) |
| R6 | Aider: flags to turn off shell suggestions, `/run`, `/test`, analytics and the update check, and behaviour with no TTY and no `--yes` | Aider not offered (M2) |
| R8 | Aider: a hash-locked `uv` install of 0.86.2 with Python 3.12 | Aider not offered |
| R9 | Cline: a structured "ask the person" event | Questions shown as text |
| R10 | Tool names per CLI (Cline's `agent_event` shapes are in `@cline/sdk`), and that web and fetch tools can be turned off | The mapping changes; Security decides on web |
| R11 | Cline and Aider: resuming a session headless | The transcript fallback (1.5) |
| R12 | ~~Codex: no stored Responses state~~ **Settled by S2 (e):** `thread/start {ephemeral: true}` | |
| R13 | Which of Bunny's providers serve `/v1/responses` natively | Always translate |
| R14 | ~~Codex: the unelevated sandbox~~ **Settled by S2 (f):** no admin prompt; it confines writes, not reads | |
| R17 | Cline and Aider: self-update and telemetry can be turned off | Security decides (M5) |
| R18 | ~~Claude Code: only Bunny's settings source is loaded~~ **Settled by S1 (b):** `--setting-sources user` with an isolated `CLAUDE_CONFIG_DIR` | |
| R19 | Aider: whether it can read files outside its `cwd` (absolute paths, `/read`); spike S4 c | Aider stays behind its flag; the Chief of Staff goes back to the owner before it ships |
| R20 | Codex: its own login command and where it writes the credential under `CODEX_HOME` | Codex is local only |
| R21 | Each engine: a way to read the sign-in state without reading the credential | The state is known only from a run's error |
| R22 | Codex and Claude Code: a per-chat session folder separate from the config home | A per-chat copy of the config |
| R23 | **Settled by S2 (d) for restricted mode:** shell, unified_exec and view_image off closes outside reads. **For full mode:** an accepted command can read outside the folder. Security accepts this; the owner's answer is pending (§9) | Codex ships restricted until the owner answers |
| R24 | Cline: the same as R23 (spike S3 d) | The same as R23 |

S1 (Claude Code) and S2 (Codex) are done. Cline's hook blocking (S3) and Aider's read path (S4) are still to be proven (§0.1).

## 9. Questions for the owner (one at a time, with the drawing, O12)

1. ~~Engines that cannot check with Bunny first~~: **answered**: "restricted mode" (word 5, §0.2). Still to come, from the Chief of Staff, per engine: an open read path after S2, S3 or S4.
2. **Codex in full mode (R23):** a command Bunny accepts can read files outside the chat's folder, as Bunny's own `run_command` can today. In Ask mode you see each command before it runs. Accept this for Codex in full mode, or keep Codex restricted (no commands at all)? **Security's recommendation: accept**, as it matches Bunny's own engine. The Chief of Staff is asking.
2. ~~Updates: tested only, or also latest?~~ **Answered by Security: tested only, and every pin change gets a Security sign-off (CE-5.4).**
3. **Code-mode chats only**, with Chat mode always on Bunny's own engine? Recommendation: yes.
