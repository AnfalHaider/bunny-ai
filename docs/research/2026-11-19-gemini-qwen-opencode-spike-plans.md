# CLI-ENGINES: Gemini CLI, Qwen Code and OpenCode in full, for spike plans

Researcher, 2026-11-19. Supersedes the rankings in `2026-11-19-more-cli-engines.md` for these three; that note still holds for the others. Official repos, docs and the GitHub/npm registries only; nothing installed or run. Bunny's side was read from origin/main (`src/server/permissionRules.js`, `src/server/workspace.js`) and the spec (84e68af, §3). UNKNOWN where a page did not say. Docs for all three are large and some pages were read in part: re-read the page before building on a line.
Asked by the Chief of Staff, for the owner's named three: Gemini CLI, Qwen Code, OpenCode. Same shape as the CLI-ENGINES report, plus a comparison of each engine's rules with Bunny's.

## Verdict first

| | Own models, no account | Host approval that waits | Fail-closed on hook failure | Windows | Spike? |
|---|---|---|---|---|---|
| **OpenCode 1.19.6** (MIT) | Yes (`baseURL`, key from env) | Yes: ACP and the server API wait; no hook needed | A pending ask is rejected on cancel; failure of the client = no answer = nothing runs (to prove) | Native zip, 82 MB; docs prefer WSL | **Yes, first** |
| **Qwen Code 0.28.0** (Apache-2.0) | Yes (`modelProviders`, OpenAI/Anthropic protocols) | Yes: SDK `canUseTool`, auto-denied after 60 s; ACP | The callback times out to deny; **a PreToolUse hook that exits anything but 2 fails open** | Native zip with SHA256SUMS, 74 MB; no sandbox on Windows | **Yes, second** |
| **Gemini CLI 0.69.0** (Apache-2.0) | **No**: Gemini API shape only (`GOOGLE_GEMINI_BASE_URL`) | Yes: ACP; policy `ask_user` is **deny** when headless | A hook exit other than 2 is a warning and the tool runs: **fails open** | npm package (100 MB unpacked, Node 20+) or a 21 MB JS bundle; no Windows binary | **Only after a Gemini-shape endpoint is decided** |

## 1. Headless and structured output

- **OpenCode.** `opencode run "<prompt>"`, `--format json` ("raw JSON events"), `--attach http://localhost:4096` to a running `opencode serve`, `--dir`, `--port`, `--auto` (approve what would ask, deny rules still hold). A server API lists pending permissions and replies; its event stream is "volatile": a slow reader overflows and misses events. `opencode acp` speaks ACP over stdin/stdout, with stdout carrying only protocol. The event shapes of `--format json` are UNKNOWN (not read). [CLI v1](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/v1/content/cli.mdx), [ACP](https://opencode.ai/docs/acp/), [server](https://opencode.ai/docs/server/).
- **Qwen Code.** `qwen -p "<prompt>"` or piped stdin; `--output-format text|json|stream-json`, `--include-partial-messages`; `--input-format stream-json` is "under construction ... intended for SDK integration" and needs stream-json output. Budgets: `--max-session-turns`, `--max-wall-time`, `--max-tool-calls`. The terminal result can arrive after memory work finishes (a one-shot process "may remain running after its output is written"), so Bunny must key on the `result` message and then kill the tree (CE-8.2). A TypeScript SDK exists (`sdk-typescript-v0.1.35`). [headless](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md), [SDK](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/sdk-typescript.md).
- **Gemini CLI.** `-p`, `--output-format json` (one object: `response`, `stats`, optional `error`) or `stream-json` (events `init`, `message`, `tool_use`, `tool_result`, `error`, `result`); exit codes 0, 1, 42 (input error), 53 (turn limit); `gemini --acp` for ACP. The headless page says nothing on approvals. [headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md), [ACP](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md).

## 2. Custom endpoints, no account

- **OpenCode.** A provider block with `settings.baseURL` of an OpenAI-compatible package and `env: ["KEY"]`; model chosen as `provider/model`. No account in the example. The older v1 pages show `options.baseURL` per provider (proxy or custom endpoint); the exact v1 syntax for a wholly custom provider was not read: UNKNOWN. Credentials live in `auth.json` in the data directory. `OPENCODE_MODELS_PATH` loads the model catalogue from a local file and `OPENCODE_DISABLE_MODELS_FETCH` stops the remote fetch. [providers](https://opencode.ai/docs/providers/), [troubleshooting](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/v1/content/troubleshooting.mdx).
- **Qwen Code.** `modelProviders` with `openai`, `anthropic`, `gemini` or `vertex-ai` protocols, per-model `baseUrl`, `envKey` (the key is read from the environment and "never persisted in settings"), `wireApi` of `chat-completions` or `responses`. Qwen's own sign-in is a separate, optional route. A custom `baseUrl` must be HTTPS for some routes (image route says explicit HTTPS; whether `http://127.0.0.1` is accepted for the main route is UNKNOWN and matters, because Bunny's endpoint is loopback HTTP). [model providers](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/model-providers.md).
- **Gemini CLI.** Auth is Google sign-in, a Gemini API key or Vertex. The only redirect is `GOOGLE_GEMINI_BASE_URL` / `GOOGLE_VERTEX_BASE_URL` (HTTPS, or loopback), which keeps the Gemini wire format. Bunny's endpoint speaks OpenAI and Anthropic shapes. To use Gemini CLI, Bunny would have to serve the Gemini `generateContent` shape and translate: new work, and a CE-4 surface to harden. Fails "owner's own models" as built. [configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md).

## 3. The approval channel, and what happens when it fails

**OpenCode: no hook is needed; the host answers over ACP or the server API.**
- Rules: allow, ask or deny per action; **last matching rule wins**; no match means ask. `ask` waits for the client: `once`, `always` (saves project allow rules), `reject` (also rejects every other pending request in that session). ACP: "Pending permission requests are rejected" on cancellation. [permissions](https://opencode.ai/docs/permissions/).
- Defaults are permissive: "Most permissions default to allow" (v1 page; `external_directory` and `doom_loop` ask; `.env` reads ask). The newer page says all allowed and no default `external_directory` rule. **Bunny must send an explicit rule set** (`OPENCODE_PERMISSION` or `OPENCODE_CONFIG_CONTENT`) with `*` set to ask, and prove the engine honours it for read, edit, shell, webfetch, subagent and MCP.
- `always` must never be sent back (CE-1.5: no decision cached). Bunny answers `once` or `reject` only.
- What a hung or dead client does is UNKNOWN: the ACP page only covers cancellation. Test: kill the client with a request pending and show nothing ran.
- Plugins can hook tools (`.opencode/plugins/`, `~/.config/opencode/plugins/`, npm packages "installed automatically using Bun at startup"); whether a plugin that throws blocks the tool: UNKNOWN. Bunny should not use plugins at all (see §5).

**Qwen Code: callback or ACP, plus an optional hook with a fail-open default.**
- SDK `canUseTool`: "Must respond within 60 seconds or the request will be auto-denied". That is CE-1.2's first option in a shorter form than Security's "longest an Ask card can wait": the Ask card may need to wait longer than 60 s, so either the timeout is configurable (UNKNOWN) or the card answer must be **deny at 55 s**, and the person asked again. Flag for Security.
- `permissions.allow` / `allowedTools` bypass the callback ("Matching tools bypass `canUseTool` ... only applies when tool requires confirmation"). Bunny must pass none.
- Hooks exist (`PreToolUse` etc.): exit 0 JSON controls; **exit 2 blocks; "Other: Non-blocking error ... execution continues"**; HTTP hook failures are non-blocking too. So a hook alone fails open (CE-1.1's trap). Use the callback; if a hook is used, it must be the second layer with a catch that prints deny (CE-1.7).
- Modes: plan, default (Ask Permissions), auto-edit, **auto (the default: an LLM classifier approves)**, yolo. In **headless** runs "Auto and Ask Permissions exclude shell, monitor, `edit`, and `write_file` tools by default" unless an allow rule keeps them: so a plain headless Qwen is a reads-only engine, which is a natural restricted mode (CE-2.4) but not a full one. Qwen's own protection of self-modifying and persistence paths (`.qwen/settings*.json`, `QWEN.md`, `AGENTS.md`, `.git/`, `.husky/`, `package.json`, `Makefile`, `.github/workflows/`) applies in Auto mode only. [approval modes](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/approval-mode.md), [auto mode](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/auto-mode.md), [hooks](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md).

**Gemini CLI: policy engine and hooks; the safe default is a headless deny.**
- Policy decisions `allow`, `deny`, `ask_user`; "In non-interactive mode, this is treated as `deny`". So with every rule `ask_user`, a headless run **denies everything**: fail-closed, but it also means a headless run cannot ask the host. The host-asking path is ACP.
- Hooks: `BeforeTool` can return `decision: deny`; **exit 2 blocks; "Other: Warning ... the CLI continues"**; default timeout 60 000 ms. Fails open on crash or timeout, as Claude Code did in S1(c).
- Rules: tiers Default (1), User (3), Admin (4/5), priority 0 to 999 inside a tier, **highest wins**; the **Workspace tier "is currently non-functional"**, so a repo cannot weaken or strengthen rules (good for isolation, useless for Bunny's per-folder rules). Modes: `default`, `autoEdit`, `plan` (read-only), `yolo`; settings `security.disableYoloMode` and `security.disableAlwaysAllow` exist. [policy engine](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md), [hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md).

## 4. Sandbox, and whether reads are confined

- **OpenCode:** no sandbox found in the pages read. Confinement is by permission rules only (`external_directory` for paths outside the start directory). Reads inside the workspace default to allow. Windows: a native zip, but the docs "recommend WSL".
- **Qwen Code:** a "tool execution sandbox" for Shell and file tools exists **on Linux only** (bwrap or Landlock; `tools.executionSandbox`, system or user settings only). **Reads remain broad** even there ("this mode does not hide host secrets"). macOS Seatbelt and Docker/Podman run the whole CLI. **No Windows confinement.**
- **Gemini CLI:** macOS Seatbelt (writes confined, broad reads allowed in the default profile; `strict-*` profiles restrict reads) and Docker/Podman/runsc/lxc containers. **None native on Windows**; a container on Windows is a Docker dependency Bunny cannot assume.
- **Consequence:** on Windows none of the three gives Bunny a wall. All three depend on per-call approval (full mode) or a staged copy with commands off (restricted mode); reads outside the folder are the R24-style open question for each, to be settled by the canary read in the spike, as for Cline.

## 5. Project config, hooks and rules from the repo, and the switch

- **OpenCode.** Project config is loaded (merged from the working directory up to the filesystem root); `.opencode/` holds plugins, agents, commands. The switch: **`OPENCODE_DISABLE_PROJECT_CONFIG`** ("Disable project configuration and project instruction files"), plus `OPENCODE_PURE` / `--pure` (no external plugins), `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_DISABLE_CLAUDE_CODE` (stops reading `.claude`), `OPENCODE_DISABLE_EXTERNAL_SKILLS`, and `OPENCODE_CONFIG_DIR` / `OPENCODE_CONFIG_CONTENT` for Bunny's own config. These are the best isolation levers of the three. Global config also loads from `~/.config/opencode/`: point `OPENCODE_CONFIG_DIR` and the XDG/home variables at Bunny's isolated home (whether a home variable moves `auth.json` and the database: `OPENCODE_DB` moves the database; auth path UNKNOWN).
- **Qwen Code.** `.qwen/settings.json` loads from the project; with folder trust **off by default**, "every folder counts as trusted ... Other project configuration can run commands without asking (for example a `ui.statusLine` of `type: "command"`)". Project hooks and MCP servers ask once per exact configuration and are withheld in headless runs ("a headless run prints one stderr line when hooks are withheld"). Switches: **`--safe-mode` / `QWEN_CODE_SAFE_MODE=true`** (no context files, hooks, extensions, skills, MCP, subagents, "permission rules", "settings-sourced approval mode overrides", LSP; `--yolo` and `--approval-mode` still work), `--bare`, and `QWEN_HOME` for the user home. **Caution:** safe mode also drops permission rules, so Bunny's deny rules must come from the host (callback), not from settings. `security.folderTrust.enabled` can be set only in user/system settings, so Bunny's isolated home can turn it on and leave the folder untrusted.
- **Gemini CLI.** `.gemini/settings.json`, `GEMINI.md`, project hooks, MCP servers, commands and skills load from the project; **Trusted Folders is off by default** ("security.folderTrust.enabled") and when enabled an untrusted folder gets safe mode. `GEMINI_CLI_HOME` moves the user config; `-e none` disables extensions; `hooksConfig.enabled/disabled`; `--admin-policy` and system settings override all. A "no project config at all" switch comparable to OpenCode's: UNKNOWN.

## 6. Telemetry and network beyond the model

| | Telemetry | Self-update | Other calls | Opt-outs |
|---|---|---|---|---|
| OpenCode | **UNKNOWN** (no page found; to be proven at the fake upstream) | `autoupdate`/`update`: `"disable"`; `OPENCODE_DISABLE_AUTOUPDATE` (project-level `update` ignored) | models.dev catalogue; LSP server downloads; Exa/Parallel web search only if enabled; session sharing exists; probes local Ollama/LM Studio/vLLM ports | `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_LSP_DOWNLOAD`, share off in config, no web-search env flags |
| Qwen Code | `privacy.usageStatisticsEnabled` default **true**; OTLP `telemetry.enabled` (default not read) | `general.enableAutoUpdate` default **true** | models.dev refresh (stops when usage statistics are off); Mem0, channels and browser features are opt-in | set both false; `QWEN_CODE_SAFE_MODE` |
| Gemini CLI | `telemetry.enabled` default **false**; `privacy.usageStatisticsEnabled` setting exists (default not read, example shows `true`) | `general.enableAutoUpdate` | extension registry URL (`geminicli.com/extensions.json`) | usage statistics false, `GEMINI_TELEMETRY_ENABLED=0`, no extensions |

[Gemini telemetry](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/telemetry.md), [Qwen settings](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md).

## 7. Licence, bundling, Windows runtime, size, pinning

| | Licence | Windows runtime | Download | Hash | Pin story |
|---|---|---|---|---|---|
| OpenCode | MIT | One binary, no Node needed | `opencode-windows-x64.zip` 81 943 749 bytes (and `-baseline` for older CPUs) in release v1.19.6 | sha256 `fa31c9ec…559bcc` in the GitHub asset digest | Pin version + asset digest; GitHub redirects to its asset host (CE-5.2). npm `opencode-ai` is a 7.8 KB launcher, not the binary |
| Qwen Code | Apache-2.0 | `qwen-code-win-x64.zip` (74 339 211 bytes) in v0.28.0; whether it bundles Node: UNKNOWN; npm package needs Node 22+ | GitHub release; also `cli.js` | `SHA256SUMS` in the release, and per-asset digests (`9a758331…97a25ed` for the zip) | Release also has nightly and preview tags: pin a stable one |
| Gemini CLI | Apache-2.0 | npm (Node 20+, 99.6 MB unpacked, 455 files) or `gemini-cli-bundle.zip` (21.4 MB, needs Node); Windows binary: none in the release read | npm or GitHub | npm sha512 integrity; zip sha256 `200ea53f…d6053` | Bundling Node is a separate pin (Bunny runs engines with Electron-as-Node: whether Gemini's bundle works under it: UNKNOWN) |

Full digests are in the GitHub release API and `npm view <pkg> dist.integrity`; copy them from there when pinning. All three need Bunny to run them from its data folder by absolute path, no installer, no admin (CE-5.6). Bundling the three licences' notices into the installer is routine; none of the three has a competing-use clause.

## 8. Each engine's permission model against Bunny's

Bunny today: rules are `{kind: command|path, pattern, effect: deny|ask|allow, ops: edits|reads}`, global and per folder, wildcard only; **deny beats ask beats allow** (strongest wins, not order or priority); rules run before the mode; Plan mode refuses edits whatever a rule says; the data folder and Bunny's secrets are protected whatever a rule says (S-3); command rules split a line into simple commands and read wrappers as unreadable; path rules judge every spelling including the real path after links; and an allow needs every part allowed. [permissionRules.js](../../src/server/permissionRules.js), [workspace.js](../../src/server/workspace.js), spec §3.1.

| | Bunny | OpenCode | Qwen Code | Gemini CLI |
|---|---|---|---|---|
| Effects | deny, ask, allow | allow, ask, deny | allow, ask, deny | allow, ask_user, deny |
| Which rule wins | **strongest effect** | **last match** (order matters) | UNKNOWN (page not read) | **highest priority number**, tiered |
| Match unit | command text (split into simple commands) and path globs | action + resource wildcard (`*`, `?`); shell resources from a built-in scanner, "compound commands can produce several" | tool name with specifier, e.g. `Bash(rm *)` | tool name plus `argsPattern`/`commandPrefix` |
| Protected paths | data folder and secrets, always | `.env` reads ask by default; `external_directory` | Auto-mode only: self-modify and persistence paths | none built in; trusted folders |
| Modes | Plan, Ask, Auto (spec) | build/plan agents; `--auto` | plan, default, auto-edit, auto, yolo | plan, default, autoEdit, yolo |
| Per folder rules | yes | project config (to be disabled) | project settings (to be isolated) | workspace tier disabled |
| Reads confined | rules only | `external_directory` ask | no | Seatbelt strict only |

**Should Bunny adopt an engine's rules? No, for three reasons from the sources.**
1. **Different precedence.** Bunny's deny-beats-everything cannot be copied into "last match wins" or "highest number wins" except by generating the engine's file from Bunny's rules in the right order. A hand-copied list would silently invert a deny.
2. **Different matching.** Bunny reads three spellings of a command and treats wrappers as unreadable; each engine matches its own parse of the tool call. An engine rule is a second wall, not the judge (spec §3.4).
3. **Failure modes.** Two of three fail open on a hook failure, and Qwen's safe mode drops rules. Bunny's judge must stay on Bunny's side (callback, ACP, server API), as the spec says: one judge, the same functions, the same order.
What is worth doing: **generate** each engine's deny rules from Bunny's deny list (protected folders, read-deny paths, the engine home) as the second wall, with a test that the generated file blocks the canary when the bridge is dead.

## 9. Spike plans

Common set for each engine (Security's CE-1.1/1.2, CE-3.3, CE-4, CE-5.5, CE-8): a fake upstream that logs every request; a fake `USERPROFILE`/home with an allow-everything rule and a hook; a project folder holding hostile project config; a canary file outside the folder; commands: "run a command", "write a file", "read the canary", "fetch a URL", "start a subagent", "call an MCP tool".

**S-OC (OpenCode), first.**
1. `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_PURE`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_LSP_DOWNLOAD`, `OPENCODE_DISABLE_CLAUDE_CODE` set; config by `OPENCODE_CONFIG_CONTENT` with `*` = ask and the engine home denied.
2. Drive it over ACP (`opencode acp`, Bunny's own ACP client with the `fs` and `terminal` capabilities not offered) and over `serve`; show every tool in the common list reaches the host as a request; answer `once`/`reject` only.
3. Failure set: client killed with a request pending; garbage reply; closed pipe; client slow past any engine timeout. Each must end with nothing run.
4. Telemetry and network: the capture shows only the model call; note the models.dev and share behaviour.
5. Windows: native zip on the owner's PC, with and without Git Bash (`OPENCODE_GIT_BASH_PATH` exists, so shell tool needs it: confirm).
6. Open items to close: `--format json` event shapes; v1 custom-provider syntax; where `auth.json` goes; whether the V1 and V2 permission names both load.

**S-QW (Qwen Code), second.**
1. Settings: `--approval-mode default`, no `permissions.allow`, `general.enableAutoUpdate` false, `privacy.usageStatisticsEnabled` false, `security.folderTrust.enabled` true in the isolated user home (`QWEN_HOME`), the project folder untrusted; `tools.exclude` for web fetch and subagents.
2. Drive it from the TypeScript SDK with `canUseTool`; show each tool in the common list reaches the callback; show a 60 s silence is a deny, and decide how Bunny's longer Ask card is handled (flag for Security).
3. Do not rely on `--safe-mode` (it removes rules); do rely on the callback.
4. Hook failure test only if a hook is used at all; otherwise show that no hook is loaded from the project.
5. Check `baseUrl` accepts `http://127.0.0.1:<port>`; check `wireApi` chat-completions works with Bunny's endpoint.
6. Windows: the zip, whether it needs Node, canary read outside the folder, the detached-result process (kill the tree after `result`).

**S-GM (Gemini CLI), only if the owner wants it.** Prerequisite: a Gemini-shape endpoint in Bunny (new work) or the owner accepting that Gemini CLI is "bring a Gemini key". Then: ACP `request_permission` for every tool; policy file in `GEMINI_CLI_HOME` with all `ask_user` and `deny` for web and shell in restricted mode; `security.disableYoloMode`, `disableAlwaysAllow`; hook failure shown to fail open and therefore not used; trusted folders on; Windows run from the 21 MB bundle under Electron-as-Node (UNKNOWN whether it runs).

## Not verified

Qwen's rule precedence between allow/ask/deny and its `permissions` syntax; whether Qwen accepts a loopback HTTP base URL; whether Qwen's Windows zip bundles Node; OpenCode's telemetry, `--format json` shapes, v1 custom-provider syntax, behaviour with a dead ACP client, and `auth.json` location; Gemini's default for usage statistics and any "no project config" switch; Gemini bundle under Electron-as-Node; any Windows run of the three (none was run); OpenCode V1 versus V2 naming (release 1.19.6 is V1; the permissions page for V2 says it "isn't enforced in OpenCode 1"). Pages were read through a summarising fetch tool and the GitHub API on 2026-11-19.
