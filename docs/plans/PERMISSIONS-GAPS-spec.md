# PERMISSIONS-LIKE-CLAUDE: the rule and protection gaps

Tech Lead, 2026-11-20. v0.1.15. It feeds the PERMISSIONS-LIKE-CLAUDE workstream.

- **Source:** the gap list in the Researcher's `docs/research/2026-11-20-permissions-like-claude.md` (claude/researcher-perm-like-claude, dcec6eae), section "How each compares with Bunny's current model", cited here as [R].
- **Every item is HIGH,** because each one changes a permission or a protection. The steps are: Design draws, Security reviews, then the owner's go.
- **Code references** are at e2ec6ec6.

## Today

- **Rule kinds.** A rule is `kind: 'command' | 'path'` with `effect: deny | ask | allow`, and `ops: edits | reads` for paths (`permissionRules.js:4`, `:26`).
- **There is no rule for:**
  - a network address;
  - a tool by name (a connector tool, the browser, desktop control);
  - a helper agent or another chat.
- **Protection.** Bunny's own file tools refuse `.git` (`workspace.js:289`, `refuseGit`), and the data folder and key folders are protected.
  - The "runs code later" list (`RUNS_LATER`, `staging.js`) applies only to the engines' restricted copy-back, **not to Bunny's own `write_file` and `edit_file`**.
  - Claude protects repository and tool configuration in every mode below bypass ([R] §1 "Protected paths").

## PG-1: rules for a network address

### Owner's question

"May the permission rules also name a website (for example 'ask before example.com', 'never api.paste.io'), for Bunny's own page reading, downloads and browser?"

- **Recommendation:** yes.

### Behaviour

- **The rule:** `kind: 'domain'`, `pattern` is a host with `*` wildcards (`*.example.com`), with the usual effects.
- **Judged on:**
  - `read_url`;
  - `download_file`;
  - `browser_open` and every browser navigation;
  - `web_search` results opened by the model;
  - a remote connector's address when it is added.
- The host is taken from the final address after redirects (`fetchLimited` already follows them), and judged at **each** hop.
- **The order is the usual one:** deny, then ask, then allow, then the mode.
- **Not covered, and said in Settings:** what a command does on the network. Bunny can't see inside a command. F13's option B is the only network limit for commands.

### Security's required changes (00e89f3f)

- **PG1-a: matching.**
  - The host is normalised first through `new URL`: lowercase, the trailing dot removed, IDN converted to punycode, and IP literals normalised (decimal, hex and short forms).
  - `*.x.com` matches subdomains only, and `x.com` matches exactly. The editor offers both.
  - Ports are ignored.
- **PG1-b: an allow never weakens a fixed protection:** `fetchLimited`'s private-address refusal (WA-1), the Quick ask `read_url` allow-set (WA-2) and the taint rule.
- **PG1-c: the browser panel.**
  - Deny and ask are enforced in the panel's session with `webRequest.onBeforeRequest`, for **every** request: the main frame, sub-frames, XHR and fetch, and downloads. Top-level navigation alone isn't enough.
  - An ask on a sub-resource counts as a deny, because no card can stop a page mid-load. Settings says so.
- **PG1-d: remote connectors.** A connector's address is judged when it is added and again whenever it changes. A deny on its host stops its calls.

### Tests

- **Unit:**
  - a deny on `*.paste.io` refuses `read_url` of `https://x.paste.io/a`, and refuses a redirect to it from an allowed host at that hop;
  - an ask on `example.com` shows a card in Auto;
  - an allow skips the Ask-mode card for `download_file`;
  - PG1-a: `EXAMPLE.com.`, `xn--` forms and `http://2130706433/`-style IP forms normalise and match; `*.x.com` doesn't match `x.com`; ports are ignored;
  - PG1-b: an allow on `127.0.0.1` or a private address still gets WA-1's refusal;
  - PG1-d: changing a connector's address to a denied host stops its next call.
- **End-to-end:**
  - a browser navigation to a denied host is stopped, and the step says why;
  - PG1-c: a page on an allowed host that loads a script, a frame and a fetch from a denied host has all three blocked, and a sub-resource on an ask host is blocked too.
- **QA:** add a domain rule in Settings, then check that it holds for reading a page, a download and the browser.

## PG-2: rules for a tool by name

### Owner's question

"May rules name a tool (for example 'always ask before any Notion tool', 'never use desktop control in this folder')?"

- **Recommendation:** yes.

### Behaviour

- **The rule:** `kind: 'tool'`, `pattern` is a tool name with `*`.
  - **Connector tools** are stored by **connector id plus the original tool name** (PG2-a), and shown as `<connector name>:<tool>`. Example: `notion:*`. Renaming a connector, or a clash rename of a tool, can't escape a rule.
  - **Bunny's own tools** are written by name: `browser_*`, `computer_*`, `github_create_*`, `gmail_send`.
- **Judged** for every tool call, after Plan and before the mode, in the usual order.
- **What an allow can't do:** an allow rule can't remove an ask that is fixed in every mode (sending, `create_tool`, `install_from_github`, local connectors, PG-4's protected paths). The rule screen marks those as "always asks".
- **F9's "save as a rule"** writes these for connector tools only. Computer and browser kinds can't be saved (F9-6).

### Security's required changes (00e89f3f)

- **PG2-a:** the key is the connector id plus the original tool name (above).
- **PG2-b: an allow never switches a capability on.** An allow on `computer_*` or `browser_*` doesn't offer those tools unless the capability is on.
- **PG2-c:** an allow never removes a fixed ask (above). The rule list marks those as "always asks".

### Tests

- **Unit:**
  - `notion:*` with ask asks for every Notion tool in Auto;
  - `computer_*` with deny refuses the computer tools, and they aren't offered either;
  - an allow on `gmail_send` still asks;
  - PG2-a: renaming the Notion connector, or a clash rename of its tool, keeps the rule in force;
  - PG2-b: an allow on `computer_*` with computer use off offers no computer tools.
- **End-to-end:** a connector tool under an ask rule shows "Asked because of your rule".
- **QA:** add a tool rule, and check the rule list's "always asks" marks.

## PG-3: rules for helpers and other chats

### Owner's question

"May rules say whether Bunny can start helpers or message other chats, for example 'ask before starting helpers in this folder'?"

- **Recommendation:** yes, with one kind and the usual three effects.

### Behaviour

- **The rule:** `kind: 'agent'`, `pattern` is one of:
  - `helper:*` or `helper:<job>` (code, research, see, chat) for `run_subagent`;
  - `chat:start`, for `start_session` and `move_to_new_chat`;
  - `chat:message`, for `message_session`.
- **Judged when the agent call is made.** A helper's own tool calls stay under the same rules as the chat (they already are).

### Security's required changes (00e89f3f)

- **PG3-a: `chat:message` is a send.** `message_session` speaks for the person, so an allow rule may **not** skip its card. Allow skips the Ask-mode card only for `helper:*` and `chat:start`.
- **PG3-b: helpers.** A helper's own calls stay under the chat's rules, PG-1, PG-2 and PG-4 included. A helper can't start helpers or chats (`HELPER_NEVER`, unchanged).

### Tests

- **Unit:**
  - `helper:*` deny refuses `run_subagent`, and the model is told;
  - `chat:message` ask asks;
  - an allow skips the Ask-mode card for `helper:*` and `chat:start`;
  - PG3-a: an allow on `chat:message` still shows the card, in every mode;
  - PG3-b: a helper's `read_url` to a denied host and its edit of `AGENTS.md` are judged exactly as the chat's.
- **QA:** with a deny on helpers, a big task runs without helpers and says so.

## PG-4: protected paths for Bunny's own file tools

**Status: the owner said "Not yet"** (recorded at 1e55d2c6). PG-4 is not built in v0.1.15.

- **The instructions-file part** is covered another way, by Security's replacement: the folder's instructions files are **frozen by content** at Follow them, and only the person's Read again, with a diff, changes what is sent (FOLDER-RULES §2, ONE-INSTRUCTIONS §1).
- **The rest of the list** stays here for a later question.

### Owner's question

"Should Bunny always ask before its own file tools change files that make code run later or that configure your tools (`.vscode`, `.github/workflows`, git hooks, shell profiles, `package.json` scripts, `.mcp.json`), in every mode, Auto included?"

- **Recommendation:** yes. It is what Claude Code does ([R] §1).

### Behaviour

1. **One shared list,** `PROTECTED_WRITES`, from `RUNS_LATER` (`staging.js`) plus [R]'s Claude list:
   - folders: `.vscode/`, `.idea/`, `.husky/`, `.github/workflows/`, `.devcontainer/`, `.config/git/`, `.claude/`, `.codex/`, `.cursor/`;
   - files: `package.json`, `.gitconfig`, `.npmrc`, `.yarnrc*`, `.mcp.json`, `.pre-commit-config.yaml`, `Makefile`, `*.ps1`, `*.bat`, `*.cmd`, `pyproject.toml`, `setup.py`;
   - shell and PowerShell profiles anywhere inside the workspace (`.bashrc`, `.profile`, `.zshrc`, `Microsoft.PowerShell_profile.ps1`).

   `.git` stays **refused**, as today.
2. **For `write_file`, `edit_file`, `multi_edit`, `download_file` and `make_*`,** a path on the list **asks in every mode, Auto included.** The card is marked "changes how code runs later".
   - An allow rule doesn't unlock it, and neither do F9's kinds or F11's judge (which may still block it).
   - **The exception, for usability (narrowed by PG4-b):** a `package.json` edit asks only as an ordinary edit **only** when, comparing the parsed JSON before and after, it changes nothing but the versions of packages already listed in `dependencies` or `devDependencies`, and no version becomes a URL, `git`, `file:`, `link:`, `github:` or tarball form. **Adding a new package name asks in Auto,** because the next install runs its scripts.
3. **Engines.** The same list is already an Ask for restricted copy-back. In full mode the bridge applies it to engine Write and Edit too, so all three engines agree.
4. **Plan mode** already refuses every write.

### Security's required changes (00e89f3f)

- **PG4-a: added to `PROTECTED_WRITES`,** matched case-insensitively at any depth on the realpath relative to the workspace:
  - **the instructions files Bunny follows:** `AGENTS.md`, `CLAUDE.md`, `.cursorrules` and `.cursor/rules/**`. Without them, a model in a trusted folder could rewrite the instructions every later chat follows. (`.claude/` and `.cursor/` are already listed.)
  - `.gitattributes`, whose filters and textconv run programs, and `.gitmodules`;
  - CI configuration: `.gitlab-ci.yml`, `azure-pipelines.yml`, `.circleci/`, `Jenkinsfile`, `.buildkite/`;
  - `lefthook.yml`, `.lefthook*`, `.envrc`, `.pnpmfile.cjs`;
  - `*.psm1`, `*.sh`, `*.vbs`.
- **PG4-b:** the narrower `package.json` exception (above).
- **PG4-c: with Bunny's engine off** (ENGINE-RULES, the floor only), PG-4 joins the floor as a **flag** on the engine's card, where there is one, the same way the floor flags commands. It is not a deny, because the person chose "follow the engine".
  - **This extends ER, so it needs the owner's word.** It is question 1b below.

### Tests

- **Unit:**
  - each listed path asks in Auto, and an allow rule on `**` doesn't skip it;
  - PG4-a: each added name asks, including at depth (`docs/AGENTS.md`), in other case (`agents.md`) and through a junction, which is judged on the realpath;
  - PG4-b:
    - raising the version of an existing dependency asks only in Ask mode;
    - adding a new package, a version set to `git+https://…`, `file:../x`, `link:`, `github:a/b` or a `.tgz` URL, and a `scripts` change all ask in Auto;
  - `.git/` is still refused;
  - an engine Write in full mode to `.github/workflows/x.yml` asks through the bridge;
  - PG4-c (if the owner agrees): with Bunny's engine off, an engine's edit of `AGENTS.md` carries the flag on its card, and isn't denied.
- **End-to-end:** in Auto, the stand-in model edits `.vscode/tasks.json`, and the card says "changes how code runs later".
- **QA:** in Auto, on an invented project, run a normal coding task. Only the protected files ask, and the count is in the QA note.

## PG-5: read-only commands that never ask

### Owner's question

"In Manual (Ask) mode, may a short list of commands that only read (`git status`, `git diff`, `git log`, `dir` / `Get-ChildItem`, `type` / `Get-Content`, `npm ls`, `node --version`) run without a card?"

- **Recommendation:** yes. It is Claude Code's built-in read-only set ([R] §1 "Allowed without asking").

### Behaviour

- A fixed list `READ_ONLY_COMMANDS`, matched on the whole command after `commandParts`.
  - A command matches only when **every** part is on the list and there is no redirect, substitution or pipe to anything off the list.
  - The list is in code, shown read-only in Settings, and can't be extended by the folder.
- **The person's own rules come first:** a deny or ask rule on `git log*` still applies.
- **SEARCH-PC taint still asks.**

### Security's required changes (00e89f3f)

- **PG5-a: Bunny runs the git forms with fixed options.**
  - The form is `git -c core.fsmonitor= -c core.pager=cat -c diff.external= --no-pager <cmd>`, and `diff`, `log -p` and `show` also get `--no-ext-diff --no-textconv`.
  - Without them, a repository's config or attributes can make `git status` or `git diff` run a program (`core.fsmonitor` runs on `git status`).
  - These options are added by Bunny; the model's own `-c` is never accepted (F9-1).
- **PG5-b: path arguments are judged as reads.**
  - The path arguments of `dir`, `Get-ChildItem`, `type`, `Get-Content` and the like go through the read rules, the floor and the protected paths. A path outside the workspace gets a card.
  - Otherwise `type C:\Users\…\.ssh\id_ed25519` would run with no card.
- **PG5-c: only the exact listed forms, each with an allowlist of flags** (for example `git log --oneline -n <N>`).
  - An unknown flag gets a card.
  - `npm ls` and `node --version` take no other arguments.
- **PG5-d:** the taint card and the person's rules still come first (above).

### Tests

- **Unit:**
  - `git status` runs with no card in Ask;
  - `git status; rm -r x`, `git log > out.txt` and `Get-Content a | Set-Content b` all ask;
  - an ask rule on `git status` asks;
  - PG5-a: in an invented repository with `core.fsmonitor` set to a probe script, `git status` run by Bunny doesn't start the probe, and with a `diff.external` probe `git diff` doesn't start it either;
  - PG5-b: `type ..\outside.txt`, `Get-Content $HOME\.ssh\id_ed25519` and a read-denied path each get a card or a refusal;
  - PG5-c: `git log --format=%H` (not on the flag list) gets a card, and `npm ls x` gets a card.
- **QA:** a read-only look around a project in Ask mode has no cards.

## PG-6: importing another app's rules can't invert a deny

### Behaviour

- **Not an owner question:** it keeps today's rule order. LOW, but listed here because [R] names it.
- When the engine's own rules (ENGINE-RULES) or an imported plugin bring rules written for OpenCode, whose last match wins ([R] §2 "Who wins"), Bunny converts them to its order: deny, then ask, then allow.
- The import screen shows any rule whose meaning changed.

### Security's required changes (00e89f3f)

- The import screen shows each changed rule's **new meaning before saving**, and nothing is saved until the person confirms.
- An import that would add an allow wider than an existing deny is listed **first**.

### Tests

- **Unit:**
  - an OpenCode-style list `[allow '*', deny 'rm*']` imports as deny `rm*` plus allow `*`, and `rm -r` is denied;
  - the preview lists the changed rule with its new meaning, and nothing is saved until confirm;
  - an import holding an allow wider than an existing deny lists it first.

## The owner's questions, in order (O12)

1. **PG-4** Protected paths. Recommended: yes. It makes Auto safer, which F11 and F12 build on.
   - **1b. PG4-c, asked with it:** "With Bunny's engine off, should the engines' cards also be marked when they change one of these files?" Recommended: yes, a mark and never a block. It extends ENGINE-RULES.
2. **PG-5** Read-only commands. Recommended: yes.
3. **PG-2** Tool rules. Recommended: yes. F9 saves into these.
4. **PG-1** Domain rules. Recommended: yes.
5. **PG-3** Agent rules. Recommended: yes.
