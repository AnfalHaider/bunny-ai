# CLI-ENGINES (v0.1.14, HIGH): Security's requirements

Against Tech Lead's spec, revision 4 (84e68af on claude/tech-lead-cli-engines, `docs/plans/CLI-ENGINES-spec.md`). The owner approved the Engines page (v3, 90a1288, control B), which is the go to build after the spikes.

The spec's musts (M1–M7) stand. These requirements tighten them where the spec leaves a gap, or asks Security to decide. Each is CE-n, and Builder shows a test or spike evidence for each. "Engine" means Claude Code, Codex CLI, Cline or Aider.

## CE-1: the hook and approval bridges fail closed, in every way they can fail

1. **The hook must block on every failure.** Claude Code treats a `PreToolUse` hook that exits 1, or any code but 2, as a **non-blocking** error, and the tool runs. So the hook:
   - writes a deny decision (JSON `permissionDecision: "deny"`, or exit 2) on every path;
   - is wrapped so that an uncaught error, a crash, a bad answer from the bridge, or an unreachable bridge all end in deny;
   - **Spike S1(c) must show each of these is a deny:** the hook crashing, the hook's runtime missing (Node or Electron-as-Node not found), the hook killed, the bridge closed, the bridge answering garbage, and the hook timing out. Run the same set for Cline (S3).
2. **A hook timeout must never become "allow".**
   - Either set the CLI's hook timeout above the longest an Ask card can wait, with the bridge answering deny before that limit;
   - or answer Asks through the CLI's waiting permission channel (`canUseTool`, `--permission-prompt-tool`, Codex `requestApproval`), which can stay pending.
   - S1 must show a hook timeout means deny.
3. **The hook starts by absolute path.** The hook command is the absolute path of Bunny's own runtime (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`) and an absolute path to the script, never a bare `node` (the W29-1 lesson). The script is a fixed text from Bunny's code. It is rewritten at every run start, and its sha256 is checked before the run starts.
4. **The bridge listener** follows the same rules as CE-4: 127.0.0.1 only, an exact Host, no Origin, the run's token. It answers only its own run's requests.
5. **Every call is judged.** No decision is cached across calls, and "allow always" from a CLI's own prompt is never used.
   - The bridge maps the CLI's tool to Bunny's step name. Anything not mapped (an MCP tool, a subagent tool, a new tool after an update) is judged as `run`.
   - Paths are canonicalised (realpath, 8.3, junctions, case) against the workspace before the rules are checked, as `createWorkspace` does.
6. **Reads outside the workspace (the spec asks Security, §3.1):** **Ask in every mode, Auto included.**
   - These are always **Deny**, whatever the mode or rules:
     - Bunny's data folder;
     - every engine home, of any engine, in both modes;
     - the person's own `~\.claude`, `~\.codex`, `~\.cline` and `~\.aider*`;
     - `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker` and `.config\gh`;
     - `%APPDATA%` and `%LOCALAPPDATA%`.
   - Writes outside the workspace are always Deny (as the spec says).

## CE-2: restricted mode, the staged copy

1. **What the copy leaves out:** every read-deny path, the data folder, every engine home, `.claude`, `.codex`, `.cline`, `.aider*` and `.git`. It leaves out **every symlink, junction and reparse point**, which are skipped rather than followed. For a git repo, the copy has no `.git` that points back to the real one (no worktree link).
2. **What the diff judges:** every added, changed and deleted path, renames and file-type changes included. **Always discarded** and named in the reply:
   - anything under `.git`, or any of the engine-config folders above;
   - any path with `:` after the drive letter (alternate data streams);
   - Windows reserved names (`CON`, `NUL`, `COM1` and the like), and names ending in a dot or space;
   - any link;
   - any file over the workspace's write limit.
3. **Files that make something run later.** These are **Ask in every mode, Auto included**, and named on the card as "runs code later":
   - `package.json` (its scripts);
   - `.vscode\tasks.json`, `.vscode\settings.json` and `.vscode\launch.json`;
   - `.github\workflows\*`;
   - `Makefile`;
   - `*.ps1`, `*.bat`, `*.cmd`;
   - `.husky\*`, `.pre-commit-config.yaml`;
   - `pyproject.toml` and `setup.py`.

   A restricted turn runs no commands, so it must not plant one silently.
4. **Commands off is required for restricted mode** (as the spec says). If an engine's command tools can't be turned off, it is not offered. Spike evidence (R6, R23, R24): a model that asks for a command gets none run, checked at the fake upstream and in the process list.
5. **Shipping depends on the canary.** An engine whose canary read (S2 d, S3 d, S4 c) is open does not ship until the owner has answered, as the spec says. Security signs that engine only with that answer recorded.

## CE-3: account homes Bunny never reads, and the person's own homes it never loads

1. **Bunny never reads, copies, hashes, logs, exports, backs up or searches the account-mode home.**
   - Bunny writes there only its own pinned config files, by name.
   - The home is left out of the secret scan's file walk, Activity, chat export, the staged copy and SEARCH-PC (SP-2 already covers the data folder).
   - Sign-in state comes only from the CLI's own status command output, or a run's error (R21). It never comes from opening a credential file.
2. **Sign-in and sign-out:**
   - They run the vendor's fixed command, from the pinned binary by absolute path, in a visible terminal, with only the home variable set.
   - Their arguments never come from a model, a chat or a device.
   - Only Bunny's window can start them (see CE-6).
3. **The person's own config homes are never loaded** (M4). Each CLI's home variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Cline's `--config` and `--data-dir`, and Aider's config and env options) is set to the isolated home explicitly.
   - **Spike evidence:** a fake `USERPROFILE` with a `.claude\settings.json`, `.codex\config.toml` and `.cline` holding an allow-everything rule and a hook of their own. None of them is loaded. Check this for the project's `.claude` too (R18).
4. **Local mode and account mode never share a folder** (the spec's §7.3). A local-mode run's environment carries no vendor credential variable, and an account-mode run's environment carries no endpoint token.

## CE-4: the local endpoint

1. **Where it listens:** one listener per run, `127.0.0.1` with port 0, never `0.0.0.0` or the LAN address. It is separate from the window's server and from the device server. It is closed at the run's end, on Stop, and when Bunny quits.
2. **Every request must carry:**
   - an exact `Host` of `127.0.0.1:<port>`;
   - **no `Origin` and no `Sec-Fetch-*` header** (a browser sends one or the other);
   - the run's token (`randomBytes(32)`, compared with `timingSafeEqual`);
   - JSON of at most `MAX_MESSAGE_BODY`;
   - only the listed paths.

   Anything else gets a 403 with no detail, no CORS headers, and `no-store` (as the spec says).
3. **The token** goes by environment only, never on the command line (spec §2.2). It is never logged, never written into any file the engine can read except where the CLI requires it in its isolated config (Codex reads it from `env_key`, so not even there), and it dies with the run.
4. **No key reaches the engine.** No response carries a provider key or the upstream's headers. Upstream error text passes through `looksSecret` before it reaches the CLI.
5. **The owner's money.** The endpoint ignores the model the CLI asks for (as the spec says). An engine run counts against the chat's `replyCaps` token budget, and reaching it shows the existing `onLimit` card. An engine cannot spend past what Bunny's own engine could in the same chat.
6. **Limits:** at most 4 requests at once per run. Every upstream call uses the existing `waitLimits`.

## CE-5: downloads and hashes

1. **Every byte that runs is hash-pinned.** That covers:
   - every release asset and helper;
   - Claude Code's package (plus its Authenticode signature, "Anthropic, PBC");
   - Cline's whole npm tree;
   - `uv`, the Python runtime `uv` installs, and **every** Aider wheel.

   Specifically:
   - **npm:** a lockfile with an `integrity` value for every package, installed with **`--ignore-scripts`**. If Cline needs an install script, that is a spike finding Security reads before Cline ships.
   - **Python:** hash-locked (`--require-hashes` or uv's equivalent), with **no source builds** (wheels only).
   - **The Python runtime:** pinned by URL and sha256.
2. **Where it comes from:** HTTPS only. The URL must be the pinned one, and every redirect hop must be on that pin's own host list. GitHub's asset host must be on the list, or GitHub downloads will fail, since GitHub redirects release downloads to a separate host. The sha256 is the real check, so a host list never replaces it.
3. **Unpacking:**
   - nothing outside the staging folder: no absolute paths, no `..`, no drive letters;
   - no symlinks or hardlinks, no `:` (alternate data streams), no reserved names;
   - total size at most 2 GB, so an archive bomb stops.
   - A failure removes the staging folder.
4. **Which versions:** tested pins only. Security's answer to the spec's question 2 is **tested only**, never "latest, untested".
   - `engines.json` between releases is read only from Bunny's own GitHub Releases feed, which `updater.js` already trusts, and must carry a sha256 for each file.
   - **Every pin change is a Security sign-off** (a docs sign-off). Security reads the vendor's release notes and advisories for the new version. This is the "known-CVE check by version" the spec leaves to Security (§5.4.2).
5. **Self-updates and telemetry are off for every engine** (M5, R17), with every vendor variable for "non-essential traffic" set where one exists. The spike checks this at the network level: the fake upstream sees every request, and no other host is contacted in local mode.
6. **Elevation is never asked for.** Nothing in the engine flow runs as administrator. A step that needs elevation means that engine falls back to restricted mode, or is not offered.

## CE-6: devices

1. **Every device is refused, the Everything level included:**
   - `/api/engines*`: download, update, rollback, remove, sign-in, sign-out and status;
   - the `engine` and `engines.<id>.auth` settings;
   - `session.engine`.

   The spec says these routes are "window-only", but an Everything device is treated as the window for window-only routes, except `/api/remote*`. So these must join the device-refused set, like `isRemoteAdminPath`, not only `WINDOW_ONLY_ROUTES`. A test runs at **Everything**.
2. **Chats-level devices** never run an engine (as the spec says). An Everything device's chat may run on the engine the window chose, with every engine tool logged by name (R-DF2). An engine's Ask from a device chat is answered on that device, as for Bunny's own engine.

## CE-7: the record

1. **Every engine change is kept in a local record** shown in Settings → Engines: download, update, switch, rollback, remove, sign-in, sign-out, and auth-mode change. Each entry holds the time, the engine, the old and new versions, the first 12 characters of the sha256, and who did it (always the window).
2. **Device engine tools** are logged as `{kind: 'tool', tool: '<engine id>:<mapped name>'}`. Never the input, the command or the path.
3. **Bridge denials** are logged by name in the chat's steps, with the rule's one-line reason. Inputs are never logged beyond what the step already shows.

## CE-8: starting the engine process

1. **The binary and environment:** the binary starts by absolute path (`safeExec`), with `windowsHide`, `safeEnv` plus only the variables the adapter names, and no inherited handles but the pipes. **The prompt never goes on the command line**, so `-p "<prompt>"` is out: it goes by stdin (stream-json input) or a file in the isolated home. A prompt starting with `-` can't become a flag, and other processes can't read it.
2. **Stopping:** a Stop, abort, timeout, or a run that prints nothing kills the whole process tree (`taskkillPath() /T /F`, the RUN-1 lesson). No engine process outlives its run. Bunny checks this on quit too.
3. **The engine's own web, fetch, MCP and subagent tools are off** in every mode (spec §3.4, R10). Where one can't be turned off, the bridge judges it as `run`, so it is an Ask in Ask and Plan modes.

## CE-9: what Security signs each engine on

Security signs each engine's adapter only with:
- the spike evidence for its row (command plus output, O1);
- CE-1.1 and CE-1.2's failure set all showing deny;
- the canary unread, or the owner's recorded answer;
- the fake-home test from CE-3.3;
- the CE-6 test at Everything;
- the store's tests (hash mismatch, path escape, redirect off-list, `--ignore-scripts`).

## CE-1 ruling after spike S1 (2026-11-19): Claude Code may run in full mode, with these layers

**Evidence:** Builder C's S1 on Claude Code 2.1.311, e1e568f on claude/builder-c-v0114-spikes (`docs/spikes/cli-engines/s1/`). I read the README and `e-killed-noprompts.txt`.
- (a), (b) and (d) pass.
- **(c) fails open, as CE-1.1 feared.** A hook that crashes, exits 1, prints garbage, times out, is killed, or has no runtime doesn't block, and the tool runs.
- With the hook killed, `--permission-prompts none` denied Write, Bash, WebFetch, MCP and the canary outside the folder ("no approval surface"). A workspace `Read` still ran. A `permissions.deny` in Bunny's `--settings` kept `secret.txt` unread with the hook killed.

**Ruling:** full mode is acceptable for Claude Code **only with every one of the layers below**. Each is a CE-1 requirement now, and each has a test or spike line. Without them, Claude Code runs restricted.

**CE-1.7, the hook catches what it can.** The hook script wraps everything in a catch that prints a deny decision. That covers an unreachable bridge, a bad answer and any exception. It's the first layer, not the only one.

**CE-1.8, the engine's own permissions stay on, as the second layer.**
- Claude Code always runs with `--permission-prompts none`, or a `--permission-prompt-tool` that answers deny.
- `--setting-sources user` with the isolated, empty `CLAUDE_CONFIG_DIR`.
- **No `permissions.allow` rule anywhere** in Bunny's `--settings`.
- Never `--dangerously-skip-permissions`, `bypassPermissions` or `acceptEdits`.
- In Plan mode, also `--permission-mode plan`.

With the hook dead, writes, commands, fetches, MCP and any read outside the folder are then refused by the engine itself (S1 `e-killed-noprompts` and `e-missing-noprompts`).

**CE-1.9, Bunny's rules are copied into the engine's own settings.** Bunny writes `permissions.deny` rules into its `--settings` for:
- every Bunny deny rule;
- every read-deny (hidden) path, the data folder and every engine home;
- the protected folders;
- the key folders (CE-1.6).

Each Bunny **read Ask** rule is written as a `permissions.ask` rule. With no approval surface, an ask turns into a deny when the hook is dead.

**A spike line (S1 add-on) must show two things:**
- with the hook alive, Bunny's "allow" from the hook lets an `ask`-covered read through;
- with the hook killed, that read is refused.

If the first doesn't hold, ask-covered paths go into `permissions.deny` instead. Then those reads are never allowed for Claude Code, which is safe and costs only convenience.

**CE-1.10, a watchdog (M6).**
- Every `tool_use` id in Claude Code's stream-json must match a bridge request from the hook for the same id, arriving before the matching `tool_result`.
- A `tool_use` that reaches its result with no bridge request means the hook isn't working. Bunny stops the run at once (tree kill, CE-8.2), marks the reply "stopped: Bunny's check did not run", and offers to continue in restricted mode.
- Test this with the fake engine, with the hook disabled.

**CE-1.11, hook timeout and Asks.** Bunny sets the hook timeout above the longest an Ask card waits, and answers deny itself before that. S1 didn't test a long timeout, so add one spike line: a 5-minute hook timeout with a card answered after 2 minutes allows; one left unanswered past Bunny's limit denies. If a hook timeout does happen, CE-1.8 and CE-1.10 catch it.

**The residual, accepted:** when the hook dies, Claude Code can still read workspace files that **no** Bunny rule covers, until CE-1.10's watchdog stops the run.
- Those are the reads Bunny's own engine does without a card in every mode except Plan, inside the folder the person chose.
- Nothing can be written, run, fetched or sent through MCP. Nothing outside the folder can be read.
- Paths covered by Bunny's rules stay refused (CE-1.9).

**`--restricted`** (removes command tools and WebFetch, ignores settings files, confines file tools to the working folders): use it for Claude Code's **restricted** fallback, together with CE-2's staged copy, not in full mode. Don't count it as a wall on its own until a spike shows its confinement holds against the canary.

**Cline (S3) is held to the same layers**, in whatever form its CLI offers. If Cline has no equivalent of CE-1.8 (its own permissions as a second layer), it runs restricted.

## Rulings after S1 addendum 2 and S2 (2026-11-19, Builder C's 7b1f864)

### CE-1.9 for Claude Code: ask-covered reads go into `permissions.deny`

- **Confirmed.** With `--permission-prompts none`, a hook "allow" doesn't pass a `permissions.ask` read. So every Bunny **read Ask** path goes into `permissions.deny` in Bunny's `--settings`, alongside the deny, hidden, protected, data, engine-home and key paths.
- **The cost:** Claude Code never reads those paths, even when the person would have said yes. That's safe, and only a convenience loss. The chat says so in one line when it's refused.
- **`--permission-prompt-tool` is not to be used** in place of this until a spike shows two things: that it answers through Bunny's bridge; and that an unreachable or crashed prompt tool means deny.

### Codex CLI 0.170.0: full mode accepted, with `untrusted` and these layers

S2 (I read `docs/spikes/cli-engines/s2/README.md`) shows:
- `approval_policy = "untrusted"` asks for **every** command and **every** patch, and a decline stops each;
- `on-request` and `granular` ask for nothing once the sandbox is on;
- the unelevated sandbox confines writes, not reads;
- `view_image` reads outside the folder with **no** ask, even under `untrusted`;
- Codex reaches github.com, api.github.com and chatgpt.com until its plugin and app features are off;
- the first run writes `trust_level = "trusted"` into `config.toml`.

**Ruling:** full mode is acceptable for Codex **only with all of CE-1.12 to CE-1.17.** Without them, it runs restricted.

**CE-1.12, the policy.**
- Always `approval_policy = "untrusted"`; never `on-request`, `never` or `granular`. Don't send `capabilities.experimentalApi`.
- Bunny answers each request with `accept` or `decline` (or `cancel` on Stop). **Never `acceptForSession`**, which would stop later asks.
- `item/permissions/requestApproval` is always declined.

**CE-1.13, what Bunny judges.**
- `item/commandExecution/requestApproval`: judged as `run_command` on its command text (`checkCommand`, deny rules, mode: Ask in Ask mode, refused in Plan), exactly as Bunny's own engine.
- `item/fileChange/requestApproval`: judged per path as `write_file` or `edit_file`, with every path canonicalised. Any path outside the workspace, or in a protected, hidden, data or engine-home folder, is declined.
- Any request with input Bunny can't read is declined.

**CE-1.14, tools off in full mode too.**
- `features.view_image=false`: it's a read with no ask.
- Off as well: `apps`, `plugins`, `remote_plugin`, `plugin_sharing`, `tool_suggest`, `computer_use`, `image_generation`, `goals` and `hooks`, plus `web_search="disabled"`.
- The S2 network check (0 connections besides Bunny's endpoint) is the test, repeated at every pin change (CE-5.4).

**CE-1.15, configuration.**
- The isolated `CODEX_HOME/config.toml` is **rewritten at every run start**, with no `trust_level` entry for any project. The project stays untrusted, so its `.codex` config, hooks and exec-policy rules are never loaded.
- Add a spike line: a project `.codex/rules` with an `allow`, in an untrusted project, still gets asked for every command.
- Plus `--ignore-user-config` where available, `check_for_update_on_startup=false`, `analytics.enabled=false` and `thread/start {ephemeral:true}`.

**CE-1.16, second walls.**
- `windows.sandbox="unelevated"` with `workspaceWrite`, and `readOnly` in Plan mode, for write confinement.
- It's never elevated (CE-5.6).
- The model name Bunny sends is fixed per pin, since it decides which tools Codex offers. Bunny re-checks the tool list at `thread/start` against the expected set (`exec_command`, `write_stdin`, `apply_patch`, `request_user_input`, `tool_search`), and stops the run if anything else appears.

**CE-1.17, a watchdog (as CE-1.10).** Every `item/started` of type `commandExecution` or `fileChange` must follow an approval request Bunny accepted for that item. One that doesn't stops the run at once (tree kill) and offers restricted mode. Test it with the fake engine.

**The residual, accepted by Security:** a command Bunny **accepts** can read files outside the folder (R23 for full mode). Bunny judges only the command text, and the sandbox doesn't confine reads. That's the same exposure as Bunny's own `run_command` today: in Ask mode the person sees the command before it runs, and in Auto it runs under the same deny rules.

The spec makes this an owner question (§0.2, "the Chief of Staff goes back to the owner before that engine ships"). **Security's recommendation to the owner is: accept for Codex full mode, as it matches Bunny's own engine.** Record the owner's answer before Codex ships in full mode.

**Restricted mode for Codex**, if chosen or as the fallback:
- `features.shell_tool=false`, `features.unified_exec=false`, `features.view_image=false`, plus everything in CE-1.14;
- the tools left are `apply_patch`, `request_user_input` and `tool_search`;
- the canary stays closed (S2 `i-all-off-view-image`), and every patch asks, including ones outside the folder, which are declined;
- CE-2's staged copy and diff review apply.

## Ruling after S3 (2026-11-19, Builder C's 767c4ea): Cline is not offered in v0.1.14, in either mode

I read `docs/spikes/cli-engines/s3/README.md` (Results and Verdict).

**Full mode fails CE-1:**
- `--auto-approve false` refuses every tool in headless mode, even what the hook allows.
- `--acp` needs an account sign-in.
- `--auto-approve true` leaves the hook as the only wall, and it fails open: a crash, exit 1, garbage, a kill, a missing runtime or no hook at all, and the tools run.
- There is no engine-side second layer (CE-1.8). Under the CE-1 ruling, that means restricted at most.

**Restricted mode fails too, for a reason beyond R24's open read:**
- With `disabledTools`, `read_files` reads outside the folder, **and `editor` writes outside it**, with the hook allowing **and with the hook killed** (`y-off-tools-2`, `y-off-tools-2-killed`). No setting confines Cline's file tools to the folder.
- Restricted mode (CE-2, spec §3.3) is safe only because every write lands in the staged copy, where Bunny judges it before anything reaches the real folder. A write that lands **outside** the copy skips that review completely. That breaks M2 and CE-2, not just R24's read question, so it isn't an owner trade-off on reads.

**It also fails other musts:**
- **M5 / CE-5.5:** `data.cline.bot` (PostHog) is contacted on every run, despite every opt-out found. There's no switch.
- **CE-3.3:** the project's own `.cline/hooks` load and run on every call. CE-2.1's copy would leave them out, but in full mode nothing stops them.
- **CE-8.2:** a hub daemon outlived a killed run.
- **M3 note:** the key goes into `providers.json` in plain text. In local mode that would be only the per-run token, which is low risk; in account mode it would be the vendor's credential.
- **CE-5.1:** the npm `postinstall` script writes to `~/.cline/data`. That's avoidable with `--ignore-scripts`, which the exe doesn't need.

**Ruling:** Cline is **not offered** in v0.1.14: not in full mode, not in restricted mode, not behind a flag that ships.

Security's recommendation to the owner: leave Cline out of v0.1.14. Look again at a later Cline version only if a spike shows all of:
1. a host approval channel that works in local mode without an account, or file tools confined to the working folder;
2. a way to turn off its network calls besides the model endpoint;
3. a switch to stop the project's own hooks;
4. no process outliving the run.

Claude Code (CE-1.7 to CE-1.11) and Codex (CE-1.12 to CE-1.17) are unaffected.
