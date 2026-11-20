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

### Tests

- **Unit:**
  - a deny on `*.paste.io` refuses `read_url` of `https://x.paste.io/a`, and refuses a redirect to it from an allowed host at that hop;
  - an ask on `example.com` shows a card in Auto;
  - an allow skips the Ask-mode card for `download_file`;
  - wildcards and IDN forms (`xn--`) match the same host.
- **End-to-end:** a browser navigation to a denied host is stopped, and the step says why.
- **QA:** add a domain rule in Settings, then check that it holds for reading a page, a download and the browser.

## PG-2: rules for a tool by name

### Owner's question

"May rules name a tool (for example 'always ask before any Notion tool', 'never use desktop control in this folder')?"

- **Recommendation:** yes.

### Behaviour

- **The rule:** `kind: 'tool'`, `pattern` is a tool name with `*`.
  - **Connector tools** are written `<connector>:<tool>`, and the person sees the connector's name. Example: `notion:*`.
  - **Bunny's own tools** are written by name: `browser_*`, `computer_*`, `github_create_*`, `gmail_send`.
- **Judged** for every tool call, after Plan and before the mode, in the usual order.
- **What an allow can't do:** an allow rule can't remove an ask that is fixed in every mode (sending, `create_tool`, `install_from_github`, local connectors, PG-4's protected paths). The rule screen marks those as "always asks".
- **F9's "save as a rule"** writes these for connector tools and for computer use.

### Tests

- **Unit:**
  - `notion:*` with ask asks for every Notion tool in Auto;
  - `computer_*` with deny refuses the computer tools, and they aren't offered either;
  - an allow on `gmail_send` still asks.
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

### Tests

- **Unit:**
  - `helper:*` deny refuses `run_subagent`, and the model is told;
  - `chat:message` ask asks;
  - an allow skips the Ask-mode card.
- **QA:** with a deny on helpers, a big task runs without helpers and says so.

## PG-4: protected paths for Bunny's own file tools

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
   - **The exception, for usability:** a `package.json` edit that changes only `dependencies` and `devDependencies` (checked by parsing the before and after JSON) asks only as an ordinary edit.
3. **Engines.** The same list is already an Ask for restricted copy-back. In full mode the bridge applies it to engine Write and Edit too, so all three engines agree.
4. **Plan mode** already refuses every write.

### Tests

- **Unit:**
  - each listed path asks in Auto, and an allow rule on `**` doesn't skip it;
  - a dependency-only `package.json` change asks only in Ask mode, while a `scripts` change asks in Auto;
  - `.git/` is still refused;
  - an engine Write in full mode to `.github/workflows/x.yml` asks through the bridge.
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

### Tests

- **Unit:**
  - `git status` runs with no card in Ask;
  - `git status; rm -r x`, `git log > out.txt` and `Get-Content a | Set-Content b` all ask;
  - an ask rule on `git status` asks.
- **QA:** a read-only look around a project in Ask mode has no cards.

## PG-6: importing another app's rules can't invert a deny

### Behaviour

- **Not an owner question:** it keeps today's rule order. LOW, but listed here because [R] names it.
- When the engine's own rules (ENGINE-RULES) or an imported plugin bring rules written for OpenCode, whose last match wins ([R] §2 "Who wins"), Bunny converts them to its order: deny, then ask, then allow.
- The import screen shows any rule whose meaning changed.

### Tests

- **Unit:** an OpenCode-style list `[allow '*', deny 'rm*']` imports as deny `rm*` plus allow `*`, and `rm -r` is denied.

## The owner's questions, in order (O12)

1. **PG-4** Protected paths. Recommended: yes. It makes Auto safer, which F11 and F12 build on.
2. **PG-5** Read-only commands. Recommended: yes.
3. **PG-2** Tool rules. Recommended: yes. F9 saves into these.
4. **PG-1** Domain rules. Recommended: yes.
5. **PG-3** Agent rules. Recommended: yes.
