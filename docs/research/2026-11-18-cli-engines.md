# CLI-ENGINES feasibility: Claude Code and Codex CLI as selectable engines in Bunny

Researcher, 2026-11-18. Official docs, repos, licence files and the npm registry only; nothing installed, nothing run.
Doc pages are read through a summarising fetch tool, so re-read a cited page before hard-coding a value.
The wishlist entry named in the brief (`docs/plans/2026-11-18-v0.1.14-wishlist.md`) is not on `origin/main` (e9e84fa) from where I read it, so I worked from the brief's text, not the owner's exact words.

## Recommendation (short)

1. **Codex CLI: feasible as an optional engine, but only for providers that serve the OpenAI Responses API.** Apache-2.0, may be bundled. Its config accepts only `wire_api = "responses"`; Bunny's providers (and most free ones) speak Chat Completions. Use it for OpenAI-compatible endpoints that support `/responses`, or put a translating proxy in Bunny's server (extra work, a real new component).
2. **Claude Code: the licence forbids shipping it silently and Anthropic says it does not support non-Claude models.** Its repo licence is "all rights reserved" plus the Commercial Terms. Preinstalling is allowed under conditions that conflict with the owner's rules (each end user needs their own Anthropic credential; the binary must stay unmodified and its auth methods intact). With the owner's own non-Anthropic providers it would be an unsupported route. Recommended: do not bundle; offer "Install Claude Code" on the user's click only for people who have an Anthropic key, and treat it as Anthropic-models-only.
3. **Both are huge on Windows** (Claude Code 379 MB unpacked; Codex about 386 MB binary plus helpers). Bundling inside Bunny's installer roughly triples its size; download-on-click into the user's data folder is the better shape.
4. **Best effort per size: build one engine adapter around Codex's `app-server` (JSON-RPC, approvals) or `codex exec --json`, and Claude Code's `-p --output-format stream-json`.** Both give structured events and a way to answer permission prompts.

## 1. Versions, headless mode, event streams, permission prompts

### Claude Code

- Current: `@anthropic-ai/claude-code` 2.1.327 (latest, modified 2026-11-17), `stable` tag 2.1.311, `engines.node >=22`, bin `claude.exe`, per-platform optional packages (npm registry, `npm view`). Install page: https://code.claude.com/docs/en/setup
- Headless: `claude -p "prompt"`; `--output-format text|json|stream-json`; `stream-json` with `--verbose` (and `--include-partial-messages` for token deltas) prints one JSON object per line; the last line is a `result` message with text, cost and session metadata. https://code.claude.com/docs/en/headless
- Event types documented on that page: `system/init` (model, tools, MCP servers, plugins), `system/api_retry`, `stream_event` with `delta.type == "text_delta"`, `assistant` and `user` messages (subagent messages carry `parent_tool_use_id`), `permission_denied` system messages, and the final `result` (with `permission_denials`). Content blocks of `text`, `thinking`, `tool_use`, `tool_result` are named on the same page for subagents ("text and thinking blocks", "`tool_use` and `tool_result` blocks"). Exact field shapes for edits: UNKNOWN from that page; the Agent SDK reference (https://code.claude.com/docs/en/agent-sdk/typescript.md) is the place.
- Input: `--input-format stream-json` keeps one process alive for many turns (named on the headless page).
- Permission prompts: in `-p` runs a call that needs approval is denied unless a `PermissionRequest` hook or `--permission-prompt-tool` (an MCP tool that decides) approves it. With the Agent SDK a host passes a `canUseTool` callback and returns `{behavior:"allow", updatedInput}` or `{behavior:"deny", message}`; it may also echo `updatedPermissions` to remember a rule. The call can stay pending indefinitely. https://code.claude.com/docs/en/agent-sdk/user-input and https://code.claude.com/docs/en/headless
- `AskUserQuestion` also arrives through the same callback (multiple-choice); `--permission-prompts none` turns prompts into denials for unattended runs (v2.1.259+). Same page.
- Modes: `--permission-mode` values named: `auto`, `dontAsk`, `acceptEdits`; since v2.1.302 `claude -p` starts in manual mode when nothing sets a mode. Same page.

### Codex CLI

- Current: `@openai/codex` 0.170.0 (npm), GitHub release `rust-v0.170.0` published 2026-11-18, licence `Apache-2.0`, wrapper package `engines.node >=16`; the real binary comes from per-platform packages (`@openai/codex-win32-x64` etc.). https://www.npmjs.com/package/@openai/codex , https://github.com/openai/codex/releases
- Headless: `codex exec`; `--json` makes stdout a JSONL event stream; `-o/--output-last-message`; `--sandbox read-only|workspace-write|danger-full-access` (default read-only); `--output-schema`; `resume`; `--ephemeral`; `--ignore-user-config`; `--ignore-rules`; auth for one run via `CODEX_API_KEY`. https://learn.chatgpt.com/docs/non-interactive-mode (redirected from developers.openai.com/codex/noninteractive)
- `--json` events listed there: `thread.started` (`thread_id`), `turn.started`, `turn.completed` (`usage`: input, cached input, output and reasoning output tokens), `turn.failed`, `item.started`/`item.completed` (an `item` with `id`, `type`, type-specific fields), `error`. Item types: agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, plan updates. `exec` has no mid-run approval channel; it runs under a fixed sandbox and approval setting.
- Rich-client route: **`codex app-server`**, JSON-RPC 2.0 over stdio (JSONL), "the interface Codex uses to power rich clients". Handshake `initialize` then `initialized`; `thread/start` (model, cwd, approvalPolicy, sandbox), `turn/start`, `turn/steer`, `turn/interrupt`; notifications `item/started`, `item/completed`, `item/agentMessage/delta`, `turn/started`, `turn/completed`; server requests `item/permissions/requestApproval` and `mcpServer/elicitation/request`. `codex app-server generate-ts` / `generate-json-schema` emit schemas for the installed version. https://learn.chatgpt.com/docs/app-server (I read the first 100,000 of 153,432 characters). A README in the repo documents `item/commandExecution/requestApproval` with answers `accept`, `decline`, `cancel` (marked experimental, needs `experimentalApi`). https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Not confirmed (UNKNOWN): exact notification names for reasoning, command output and file-change items, and the file-change approval method; generate them from the installed version's schema.
- Approval policy values: `on-request`, `never`, `{granular}` (`untrusted` unsupported, `on-failure` deprecated); `approvals_reviewer`: `user` or `auto_review`. https://learn.chatgpt.com/docs/config-file/config-reference

## 2. Custom models, API shape, what breaks

### Claude Code

- Point it at a different endpoint: `ANTHROPIC_BASE_URL` plus a credential in `ANTHROPIC_AUTH_TOKEN` (Bearer) or `ANTHROPIC_API_KEY` (x-api-key); can also go in the `env` block of `settings.json`. `/status` shows the active base URL. https://code.claude.com/docs/en/llm-gateway-connect.md
- API shape: **Anthropic Messages only** (`/v1/messages`, optional `/v1/messages/count_tokens`; also Bedrock InvokeModel and Vertex rawPredict formats). A gateway must forward `anthropic-beta` and `anthropic-version`. https://code.claude.com/docs/en/llm-gateway-protocol.md
- Anthropic's position: "doesn't support routing Claude Code to non-Claude models through any gateway." https://code.claude.com/docs/en/llm-gateway
- Model names: `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` and capability overrides (named on the connect page); gateway model discovery `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` adds names to the picker.
- What breaks with other models (documented items): `400` errors on `thinking`/`adaptive` ("Input tag 'adaptive' found") when the upstream does not accept adaptive reasoning; `400` on `context_management` or unrecognised fields (workaround `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`); gateway context limits not recognised as "too long" so no auto-compaction; tool-schema `pattern` rejected by non-Anthropic upstreams on some 2.1.26x versions. https://code.claude.com/docs/en/llm-gateway-connect.md (troubleshooting table). Tool-calling quality with non-Claude models: UNKNOWN (no official statement).
- Practical consequence for Bunny: its providers speak OpenAI Chat Completions, so Claude Code would need a Chat-to-Messages translating proxy that Bunny ships and maintains, and the whole combination is outside Anthropic's support.

### Codex CLI

- Config: `~/.codex/config.toml` (`$CODEX_HOME`), keys `model_provider`, `model`, `[model_providers.<id>]` with `name`, `base_url`, `env_key`, `wire_api`, `query_params`, `http_headers`, `env_http_headers`, `requires_openai_auth` (default false). https://learn.chatgpt.com/docs/config-file/config-reference
- **`wire_api`: "`responses` is the only supported value."** The older `chat` value is gone from the reference; a maintainer replying in an issue said: "Codex works much better with the newer responses endpoint". Users of Chat-only proxies were stuck and downgraded. https://github.com/openai/codex/issues/7051
- So Codex needs the **OpenAI Responses API** (`/v1/responses`). Which of Bunny's providers implement it: UNKNOWN (OpenAI and OpenRouter document it; check each). Others need a translating proxy.
- What breaks with other models: tool/patch quality reports (e.g. model avoids the built-in `apply_patch` tool) https://github.com/openai/codex/issues/10330 ; "developer" role not accepted by some local servers https://github.com/openai/codex/issues/9392 . Thinking: `model_reasoning_effort` values depend on model and client (`low`, `medium`, `high`, `xhigh`, `max`, `ultra` listed as examples).

## 3. Licence and terms

| | Claude Code | Codex CLI |
|---|---|---|
| Licence file | https://github.com/anthropics/claude-code/blob/main/LICENSE.md : "All rights reserved. Use is subject to Anthropic's Commercial Terms of Service." (my fetch tool paraphrased it; re-read the file) | Apache-2.0, copyright OpenAI. https://github.com/openai/codex/blob/main/LICENSE |
| Redistribute in another app | Not by that file. Anthropic's legal page allows "preinstalling or running Claude Code in your products" if you agree to the Commercial Terms and meet conditions. https://code.claude.com/docs/en/legal-and-compliance | Yes: Apache-2.0 allows redistribution with the licence text, notices and a NOTICE file if present |
| Conditions | "The Claude Code binary must not be modified"; may not "remove, disable, or restrict any authentication method"; may not "pay for, resell, or intermediate Claude usage" for end users; each user authenticates with their own Anthropic key, subscription or 3P (Bedrock, Vertex, Foundry) credential | Keep licence, notices, mark changed files; Codex's trademark/branding terms: UNKNOWN |
| Non-vendor models | "doesn't support routing Claude Code to non-Claude models" (not a prohibition, but unsupported) | Allowed by config (`model_providers`), Responses API only |
| Names | May say "runs Claude Code"; may not use Claude Code or Anthropic names/logos in own product name or logo | UNKNOWN |

- Commercial Terms section D.4 bars a customer from attempting to "resell the Services except as expressly approved by Anthropic" and to "build a competing product or service". https://www.anthropic.com/legal/commercial-terms . Whether a desktop app that wraps Claude Code and also offers its own engine touches that clause is a legal question I cannot settle; flag for the owner.
- **Allowed alternative for Claude Code:** an "Install Claude Code" button that runs the official installer or `npm i -g @anthropic-ai/claude-code` on the user's click, never repackaged, then auto-update by Claude Code itself. Binary integrity: signed manifest and Authenticode signature "Anthropic, PBC". https://code.claude.com/docs/en/setup (Binary integrity and code signing)
- Signing in with a Claude subscription inside Bunny: Anthropic does not permit third-party developers to "offer Claude.ai login into their own applications" or route requests "through Free, Pro, Max, or Ultra plan credentials on behalf of their users" (legal page). Bunny must not collect claude.ai credentials; the user would sign in through Claude Code's own flow outside Bunny, or use an API key.

## 4. Packaging on Windows

| | Claude Code | Codex CLI |
|---|---|---|
| Runtime | Native binary `claude.exe`; npm package needs Node 22+ only to unpack; the binary "does not itself invoke Node". Git for Windows optional (Bash tool; otherwise PowerShell tool). https://code.claude.com/docs/en/setup | Native Rust binary (`codex.exe`); Node only for the npm wrapper (`>=16`) |
| Size | `@anthropic-ai/claude-code-win32-x64` 2.1.327: 379,537,114 bytes unpacked (npm registry) | Release asset `codex-x86_64-pc-windows-msvc.exe` 385,571,120 bytes (130,748,680 as .tar.gz); npm `@openai/codex-win32-x64` 0.170.0 518,625,391 bytes unpacked; plus `codex-command-runner` 8.9 MB, `codex-windows-sandbox-setup` 19.7 MB, `codex-windows-sandbox-service` 59 MB (GitHub release assets) |
| Pin a version | Install a specific version (`install.ps1 2.1.89` form), or npm `@2.1.327`; `autoUpdatesChannel` `stable`/`latest`; `minimumVersion`; managed `requiredMinimumVersion` / `requiredMaximumVersion` | Pin the npm version or download a release asset by tag; `check_for_update_on_startup` can be turned off |
| Update in place | Native install auto-updates in the background; `claude update`; `DISABLE_AUTOUPDATER`; `DISABLE_UPDATES` blocks all paths ("when you distribute Claude Code through your own channels") | Update by installing a newer release or npm version; in-app updater behaviour: UNKNOWN |
| Signing / SmartScreen | Windows binary is signed "Anthropic, PBC" (their setup page). Effect on Bunny's own installer: none unless Bunny's installer carries the binary; a signed third-party exe inside Bunny's installer is not re-signed | Windows signature of the release `.exe`: UNKNOWN |

- Bunny's current installer size is not in this note; adding either engine adds roughly 130 to 390 MB (compressed vs unpacked), which is a different order of magnitude from an Electron app. This is why "download on the user's click into Bunny's data folder" fits better than bundling.
- "Bundled inside Bunny, updated from inside Bunny" is workable for Codex (Apache-2.0, release assets with fixed names). For Claude Code the legal page leaves "preinstall" possible only under the Commercial Terms conditions above.

## 5. Permission and sandbox controls, and mapping to Bunny's rules

- Claude Code permissions: rules `allow` / `ask` / `deny` with patterns like `Bash(git push *)`, `Read`, `Edit` (path forms `//absolute`, `/project-relative`), settings in `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed settings, or per session with `--settings '<json>'`. Precedence of deny/ask/allow was not in the page excerpt I read (UNKNOWN; read https://code.claude.com/docs/en/permissions.md). https://code.claude.com/docs/en/sandboxing
- Claude Code sandbox: **not supported on native Windows** ("Native Windows runs commands unsandboxed"); works in WSL2/macOS/Linux; applies only to Bash, PowerShell and Monitor commands, not to Read/Edit/Write or MCP servers. Protected paths such as `.claude/settings.json` and `.mcp.json` stay write-denied. Same page. So on Bunny's platform (Windows) Claude Code's only guard is its permission rules plus Bunny answering prompts.
- Codex: `sandbox_mode` `read-only` / `workspace-write` / `danger-full-access`; Windows sandbox via `windows.sandbox` = `mxc | elevated | unelevated`; project config and MCP servers load only for trusted projects; `--ignore-rules` skips execpolicy `.rules` files. Config reference page above. The Windows sandbox needs helper executables (`codex-windows-sandbox-setup`, `-service`, `codex-command-runner`), and the `elevated` mode likely needs an admin step: UNKNOWN, not confirmed from a doc.
- Mapping Bunny's Deny/Ask/Allow and protected folders:
  - Claude Code: translate Bunny rules into a generated `--settings` JSON (`permissions.deny`/`ask`/`allow`, protected folders as `Edit(//path)`/`Read(//path)` deny rules) **and** answer anything left over through `canUseTool`/`--permission-prompt-tool`, applying Bunny's own rules there too (deny beats allow). Bunny remains the source of truth because a prompt always comes back to the host.
  - Codex: run `app-server` with `approvalPolicy: on-request` and `sandbox: workspace-write` and answer `requestApproval` calls from Bunny's rule engine (accept / decline / cancel). Protected folders cannot be expressed as deny rules the same way; Bunny must refuse the request when a command or patch path is protected, and set the working directory/writable roots narrowly. With `codex exec --json` there is no per-call channel, so only a fixed sandbox plus `--ignore-rules` is possible: weaker, not recommended.
  - Either way both CLIs run their own shell and file tools, bypassing Bunny's `run_command` limits (2-minute timeout, 8,000-character output, workspace checks) unless Bunny adds equivalent guards.

## 6. Cost: does anything need a paid account?

- **Codex:** no ChatGPT or OpenAI account is required for a custom provider (`requires_openai_auth` defaults to false; auth for the provider is `env_key`). `CODEX_API_KEY` is only for OpenAI. The binary and licence are free. https://learn.chatgpt.com/docs/config-file/config-reference . Not tested with a key.
- **Claude Code:** "requires a Pro, Max, Ultra, Team, Enterprise, or Console account" or third-party cloud credentials (setup page, Authenticate section). With `ANTHROPIC_BASE_URL` plus a gateway token it can run without a claude.ai login (connect page), but that is the unsupported non-Claude route; for Claude models it needs the user's own paid Anthropic key. A free-only owner would get no Anthropic models from it. Free claude.ai plan: "does not include Claude Code access".
- Subscription use is also excluded for third-party apps: Bunny cannot route a user's Claude subscription through its own sign-in (legal page, Authentication and credential use).
- Conclusion for the free-only rule: Codex with a free Responses-API provider is cost-free; Claude Code is not, unless the owner supplies a gateway that translates to free models, in which case support and terms issues apply.

## 7. Update 2026-11-18: the owner added Aider and Cline (four engines)

Owner's decision (relayed by the Chief of Staff): Claude Code, Codex CLI, Aider and Cline; Claude Code on the owner's own Anthropic account, installed on click, unmodified; the others use Bunny's models; all downloaded on click and updated in Settings.

### 7a. Claude Code sign-in on Windows when Bunny runs it hidden

Source: https://code.claude.com/docs/en/authentication.md (Credential management, Authentication precedence, Generate a long-lived token).

- **Where credentials live:** on Windows `%USERPROFILE%\.claude\.credentials.json`, inheriting the user profile's access controls. With `CLAUDE_CONFIG_DIR` set, the file lives under that directory instead; each directory has its own settings, history and login.
- **Order Claude Code picks a credential:** cloud-provider variables, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper` output, `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic profiles, then the subscription login from `/login`. In `-p` mode "the key is always used when present".
- **Ways Bunny can stay out of the owner's credentials:**
  1. **Let the owner sign in themselves, outside Bunny:** a "Sign in" button opens a visible terminal that runs `claude auth login` (browser flow, "Login successful"); Claude Code writes its own `.credentials.json`; Bunny then runs `claude -p` hidden and never reads that file. To keep it apart from the owner's own Claude Code, point Bunny's runs at a Bunny-owned folder with `CLAUDE_CONFIG_DIR` and sign in against that folder.
  2. **API key (Console):** the owner stores an `ANTHROPIC_API_KEY` in Bunny's existing protected store (DPAPI) and Bunny passes it only in the child process environment. That means Bunny holds the key, which the brief wanted to avoid; an `apiKeyHelper` command that reads the key from the store on demand is a variant.
  3. **Long-lived subscription token:** `claude setup-token` prints a one-year OAuth token (needs Pro/Max/Ultra/Team/Enterprise) for `CLAUDE_CODE_OAUTH_TOKEN`; "It does not save the token anywhere", so Bunny would have to store it. It "can only make model requests". Bare mode (`--bare`) does not read it.
- **Recommended:** option 1 with a Bunny-owned `CLAUDE_CONFIG_DIR`, so Bunny never sees a credential and a failed or expired login ("Login expired") is shown as "Sign in again" in Settings. Check login state with `claude auth status`-style commands: UNKNOWN (not read; `/status` is documented, a headless equivalent is not confirmed).
- **Terms:** Anthropic does not permit third-party developers to "collect, store, or intermediate Claude.ai credentials or session tokens", and sign-in must "complete through Anthropic's own flow" (https://code.claude.com/docs/en/legal-and-compliance). That rules out Bunny capturing the OAuth token or running its own sign-in form; option 1 complies, options 2 and 3 store a credential and should be reviewed by the owner and Security.
- **Do not set** `ANTHROPIC_BASE_URL` for this engine, since the owner uses Anthropic's own endpoint and Claude models.

### 7b. Aider

Facts below are from the official docs and registries; Aider has no structured stream.

1. **Headless / output:** `--message`/`-m` (send one message, process the reply, exit), `--message-file`/`-f`, `--yes` ("Always say yes to every confirmation"), `--no-stream`, `--no-auto-commits`, `--commit`, `--dry-run`. No JSON or other structured output is documented. https://aider.chat/docs/scripting.html . A Python scripting API (`Coder.create`, `coder.run`) exists but is "not officially supported or documented, and could change". Same page. So Bunny would parse plain text and read the git diff after the run for edits; thinking and tool calls as events: not available.
2. **Custom models:** `OPENAI_API_BASE` + `OPENAI_API_KEY`, then `aider --model openai/<model-name>` (the `openai/` prefix is required); any OpenAI-compatible endpoint. https://aider.chat/docs/llms/openai-compat.html . The page does not name the API shape; Aider is built on LiteLLM (my knowledge; not confirmed from these pages), which calls `/chat/completions` for `openai/` models: UNKNOWN from official text, test needed. This matches Bunny's providers without a translator. Unrecognised models give warnings.
3. **Licence:** Apache-2.0 (GitHub API: `Aider-AI/aider`, `license.spdx_id`). Redistribution allowed with licence text and notices. https://github.com/Aider-AI/aider/blob/main/LICENSE.txt . Trademark: UNKNOWN. Project health: latest GitHub release v0.86.0 (2025-08-09), last push 2026-05-22; PyPI `aider-chat` 0.86.2 (2026-02-12), `requires_python <3.13,>=3.10`. Slow-moving; the pin matters less, but maintenance risk is real.
4. **Windows packaging:** Python tool. Official install is `aider-install` (uses uv, installs its own Python 3.12 if needed), a PowerShell one-liner `install.ps1` based on uv, `uv tool install --force --python python3.12 --with pip aider-chat@latest`, `pipx` or `pip` (Python 3.9-3.12 for pipx/pip). https://aider.chat/docs/install.html . The wheel itself is small (377 KB; PyPI JSON), but its dependency tree is large (not measured; UNKNOWN). Shipping a pinned runtime: download the `uv` binary (open source, official) on click, run `uv tool install --python 3.12 aider-chat==0.86.2` into a Bunny-owned folder (`UV_TOOL_DIR`, `UV_PYTHON_INSTALL_DIR`); that pins both Python and Aider and updates by re-running with a new pin. The install page does not document `==` pinning, but `uv` and `pip` accept it (standard behaviour, not shown on that page). Antivirus or SmartScreen on a freshly downloaded `python.exe`: UNKNOWN.
5. **Permissions / sandbox:** none documented. `--yes` auto-confirms everything; Aider edits only files added to the chat and commits through git (auto-commits on by default, so every edit is an undoable commit; `/undo` exists). Aider runs shell commands only via `/run`, `/test` or confirmed suggestions; the pages I read do not describe a deny list or sandbox. https://aider.chat/docs/usage/commands.html . Mapping Bunny's rules: Bunny cannot intercept per-tool calls; it can only choose which files to add, set `--no-auto-commits` or use a worktree, and decline suggested shell commands by not passing `--yes` (which blocks without a TTY: UNKNOWN). Protected folders: enforce by never adding those files and by checking the git diff after each run.
6. **Free:** yes (no account; model cost is whatever Bunny's provider charges).

### 7c. Cline

1. **Headless / output:** `cline` npm package (3.0.74, Apache-2.0, built on `@cline/sdk 0.2.0`; GitHub release `cli-v3.0.74` 2026-10-26). Headless starts with `--json`, piped stdin or redirected stdout. `--json` prints one JSON object per line with `type` and ISO `ts`: `agent_event` (event in the `event` field), `hook_event`, `team_event`, `run_result` (final text, usage, model), `run_aborted`; errors go to stderr as `{"type":"error",...}`. Flags: `--plan`, `--auto-approve <bool>` (default true), `--config <dir>` (default `~/.cline`), `--data-dir <dir>`, `--model`, `--provider` (default `cline`), `--cwd`, `--thinking none|low|medium|high|xhigh`, `--timeout`. https://docs.cline.bot/cline-cli/overview and https://docs.cline.bot/cline-cli/cli-reference . The inner `agent_event` shapes (text, reasoning, tool call, edit) are not on the pages I read: UNKNOWN; the `@cline/sdk` types in https://github.com/cline/cline/tree/main/sdk are the place.
2. **Custom models:** `cline auth` configures the Cline provider, ClinePass or "your own provider key". Setting an OpenAI-compatible base URL from the CLI, and the provider ID to use, are not on the pages I read: UNKNOWN. The Cline extension supports OpenAI-compatible providers (my knowledge, not verified here); confirm the CLI/SDK has a base-URL setting before committing.
3. **Licence:** Apache-2.0 (repo `cline/cline` licence field and `cline` npm package). Redistribution allowed with notices. https://github.com/cline/cline/blob/main/LICENSE . Trademark/name use: UNKNOWN.
4. **Windows packaging / maturity:** The repo (`cline/cline`, last push 2026-11-17) has `apps/cli`, `apps/vscode`, `apps/cline-hub`, `sdk`; the CLI is a Node package (the npm tarball is 48 KB of launcher; it depends on `@cline/sdk` and four more `@cline/*` 0.2.0 packages). Node requirement and Windows support are not stated on the pages I read: UNKNOWN (the repo has `.nvmrc`; read it). Maturity: the CLI has its own docs, versioned releases (3.0.74) and a SDK at 0.2.0, so it is real, but the `@cline/*` packages are 0.x, so expect churn; a pinned `npm i cline@3.0.74` into a Bunny-owned prefix (needs a Node runtime: Electron's can run it with `ELECTRON_RUN_AS_NODE=1`, which is standard Electron behaviour but untested here) would give a pinned install.
5. **Permissions:** by default `--auto-approve true`: "Autonomous execution can modify files and run commands without further prompts." No allow/deny list for shell commands; the docs recommend a `PreToolUse` hook to block commands, and `--auto-approve false` for approvals. How a host answers an approval request in `--json` mode: UNKNOWN. Mapping: Bunny can supply a `PreToolUse` hook script (via `--config` dir) that calls back into Bunny's rule engine for Deny/Ask/Allow and protected folders; this is the most promising of the two new engines but unverified. https://docs.cline.bot/cline-cli/overview
6. **Free:** CLI and SDK are free and Apache-2.0; `cline auth` offers the "Cline Provider" and "ClinePass" which may be paid or need an account: using Bunny's own provider keys needs no Cline account (not verified for the CLI; check that `cline auth` is skippable).

### 7d. Where each engine stands now (summary)

| | Claude Code | Codex CLI | Aider | Cline |
|---|---|---|---|---|
| Structured stream | `stream-json` | `exec --json`, `app-server` | none (text + git diff) | `--json` lines |
| Host answers approvals | yes (`canUseTool`) | yes (`app-server`) | no | UNKNOWN (hook) |
| Wire format needed | Anthropic Messages (owner's own account) | OpenAI Responses | OpenAI chat-compatible (UNKNOWN official) | UNKNOWN |
| Licence for bundling | restricted | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| Runtime on Windows | native exe, 379 MB | native exe, ~386 MB | Python 3.12 via uv | Node + `@cline/*` |
| Free | no (own Anthropic account) | yes | yes | likely, check `cline auth` |

## Risks

1. **Wire format gap (high):** Codex needs Responses, Claude Code needs Messages, Bunny's providers speak Chat Completions. A translating proxy is a new, security-relevant component with its own bugs.
2. **Terms (high):** Claude Code bundling and non-Claude routing are the owner's legal call; I give the quoted lines, not a legal opinion.
3. **Size and installer (medium):** 130 to 390 MB per engine; first-run download needs a progress, checksum and rollback story.
4. **Bypass of Bunny's guards (high):** both CLIs have their own shell and edit tools; the Windows sandbox for Claude Code does not exist, Codex's needs helper binaries and maybe elevation (UNKNOWN).
5. **Event-schema churn (medium):** the Codex app-server API is partly experimental and Claude Code ships almost daily; pin versions, generate the schema per version, add a contract test.
6. **Quality with non-native models (medium):** documented thinking/tool breakage; Bunny's own engine stays the default.
7. **Credentials:** the engines read their own config under `~/.claude` and `~/.codex`; point them at a Bunny-owned folder (`CODEX_HOME`; Claude Code `--settings`/env) so provider keys never land in the user's home config.

## Not verified

- The owner's exact wishlist words (file not on main); Codex trademark terms; Codex Windows signature and in-app update behaviour; which Bunny providers serve `/v1/responses`; exact Codex notification names for reasoning, command output and file changes; Claude Code `permissions` precedence text; tool-calling quality with non-Claude models; anything about macOS/Linux (out of scope).
