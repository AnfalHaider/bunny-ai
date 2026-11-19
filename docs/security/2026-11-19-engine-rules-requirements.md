# ENGINE-RULES (v0.1.14, HIGH): when the owner switches Bunny's engine off, chats follow the engine's own rules

The owner's words, relayed by the Chief of Staff (HIGH go; main records it):

> "also i am thinking we have this option in settings in engines, where we disable bunny engine if done we follow the enabled engines rules, bunny stays on by default."

This adds to the CLI-ENGINES requirements (CE-1 to CE-9 and the rulings after S1, S2 and S3). While the option is off, nothing changes: Bunny judges every step, as now.

While it's on, the **engine's own rules decide allow, ask and deny**, and the engine's own questions go to the person. The words "engine's own rules" have a precise meaning here (ER-2), and a floor stays that no option removes (ER-3).

## ER-1: the option

- **Where and what:** "Use Bunny's engine", in Settings → Engines. **On by default.** Turning it off means "chats on an engine follow that engine's rules".
- **Who can change it:** it's window-only. **Every device is refused, Everything included**: it joins the device-refused set, like `isRemoteAdminPath`, not only `WINDOW_ONLY_SETTING_KEYS`. It persists once changed.
- **The record:** each change goes in Activity, with the time and "from Bunny's window".
- **Existing chats:** a chat keeps the mode it started with (`session.engine.rules = 'bunny' | 'engine'`). A change applies to new chats.
- **What it covers:** only engines in **full mode** (Claude Code; Codex if CE-1.12 to CE-1.17 hold). An engine in restricted mode (Aider; any engine that fell back) keeps CE-2's staged copy and Bunny's diff review, because it has no rules of its own to follow. Cline stays unavailable (S3 ruling).
- **No engine at all:** if no engine is enabled and downloaded, the option can't be turned off. Chats need an engine to run on.

## ER-2: "the engine's own rules" are set in Bunny, never taken from a project or the person's home

- **Where the rules come from:** the engine's allow, ask and deny rules (Claude Code's `permissions`, Codex's approval choices) are edited in **Settings → Engines → <engine> → Rules**, window-only, and written into the engine's **isolated** home on every run.
- **What is never loaded:** a repository's `.claude`, `.codex` or `.cline` configs, or the person's own `~/.claude` or `~/.codex`. CE-3.3, CE-1.8's `--setting-sources user`, and CE-1.15's untrusted entry all stay. Otherwise a repository could hand itself an allow-all.
- **Never offered, as a choice or a default:** `bypassPermissions`, `--dangerously-skip-permissions`, `acceptEdits` for every tool, Codex `never`, `on-request`, `granular`, or "yolo" or auto-approve modes. That's the "no auto-approve" rule.

## ER-3: the floor, which holds whatever the option says

1. **These are always denied** to every engine tool, written as the engine's own deny rules **and** enforced by Bunny where it can see the call (ER-5):
   - Bunny's data folder (with the DPAPI key store);
   - every engine home, both modes, including account credentials;
   - the person's real `~/.claude`, `~/.codex`, `~/.cline` and `~/.aider*`;
   - the key folders (CE-1.6);
   - `%APPDATA%` and `%LOCALAPPDATA%`.

   **Bunny's own `deny` rules are carried as the engine's deny rules too.** A deny never gets weaker because the owner chose the engine's rules. Bunny's `allow` and `ask` rules aren't carried; the engine's own decide.
2. **Devices:**
   - a Chats device never runs an engine;
   - an Everything device's engine chat sends its questions to that device, as `askPermission` does today;
   - `/api/engines*`, every engine setting and this option are refused to every device (CE-6);
   - device tools are logged by name (R-DF2).
3. **The endpoint:** 127.0.0.1, port 0, the per-run token, no Origin or `Sec-Fetch-*`, Bunny's `replyCaps` spending limit (CE-4).
4. **Downloads and pins:** CE-5, unchanged.
5. **The process:** absolute paths, `safeEnv`, the prompt never on the command line, the tree killed at every end (CE-8).
6. **The tools that stay off:** CE-1.14 (Codex: `view_image`, plugins, apps, web search) and Claude Code's web, MCP and subagent switches (CE-8.3) aren't rules. They stay off, because they're how an engine would reach past everything else.
7. **Activity:** the option's changes (ER-1); device engine tools by name; each relayed question and its answer as a step in the chat.

## ER-4: the engine's questions reach the person, with no auto-approve

- **Every question becomes a Bunny card** in the chat, or on the device for a device chat. It shows the engine's own words, the tool, and the command or path.
  - An "ask" from the engine's rules is a question.
  - Under Codex's `untrusted`, every command and patch is a question.
- **The answers:** Allow once, or Deny.
  - The card may offer "Allow for this chat" **only** where the engine supports it (Codex `acceptForSession`), and only as the person's own click. Bunny never chooses it.
  - Nothing is remembered beyond the chat.
- **Unanswered means deny:** no answer by the end of the reply (the existing card rule), or past the CE-1.11 limit, is a deny. Bunny never answers yes by itself.
- **Claude Code** gets its questions through `--permission-prompt-tool`, pointed at Bunny's bridge. **This needs a spike before it ships:**
  - a question reaches Bunny and waits for the card;
  - an unreachable, crashed or timed-out prompt tool means deny.

  If the spike fails, Claude Code stays on Bunny's rules (the option doesn't apply to it), and Settings says why.
- **The card names the engine,** for example "Claude Code asks: run `npm test`?", so the person knows it's the engine's rule asking, not Bunny's.

## ER-5: what happens to the layers

**Claude Code (CE-1.7 to CE-1.11):**

| Layer | With "Use Bunny's engine" off |
|---|---|
| CE-1.7 hook | **Kept, as the floor only.** It denies ER-3.1 paths and Bunny's deny rules, and catches its own failures as deny. Everything else returns "no decision", so the engine's rules apply. |
| CE-1.8 engine permissions on | **Kept. This is now the main wall:** `--setting-sources user`, no bypass modes, the engine's ask goes to `--permission-prompt-tool` (ER-4). The `allow` rules the owner set in Settings → Engines are now allowed (ER-2). |
| CE-1.9 Bunny's rules copied | **Changed:** only ER-3.1 and Bunny's deny rules are copied, as `permissions.deny`. Bunny's ask and allow aren't copied. |
| CE-1.10 watchdog | **Kept:** every `tool_use` must have passed the hook (the floor). If not, stop the run. |
| CE-1.11 timeouts | **Kept**, for the relayed card. |

**Codex (CE-1.12 to CE-1.17):**

| Layer | With "Use Bunny's engine" off |
|---|---|
| CE-1.12 `untrusted`, never `acceptForSession` | **Policy kept as `untrusted`.** It's the only policy that asks before commands in a sandbox (S2), and the others would be auto-approve. `acceptForSession` only as the person's own click (ER-4). |
| CE-1.13 Bunny judges | **Changed:** the person decides each command and patch on the card. Bunny still **auto-declines a patch** to an ER-3.1 path or one of Bunny's deny paths, and **flags in red** a command whose text names an ER-3.1 path. Bunny can't see what a command reads, so this is a warning, not a wall. |
| CE-1.14 tools off | **Kept.** |
| CE-1.15 untrusted project entry | **Kept.** |
| CE-1.16 sandbox, fixed model, tool list check | **Kept.** |
| CE-1.17 watchdog | **Kept.** |

## ER-6: the warning (shown when the option is turned off, and kept on the Engines page while it's off)

> **Bunny's engine is off.** Chats run on <engine> and follow <engine>'s rules, which you set here. Bunny no longer checks each step against your Bunny rules: <engine> asks you itself, and Bunny shows its questions. Bunny still blocks its own data, its keys, the engines' sign-ins and your deny rules. A command you allow can read any file on this PC that you can.

## ER-7: tests Security will look for

- The option can't be changed by a device at Chats or at Everything. It persists across restarts, and a change is logged in Activity.
- A repository with a hostile `.claude/settings.json` or `.codex/config.toml` (allow-all) doesn't change anything while the option is off.
- **Claude Code with the option off:**
  - an engine `ask` reaches a Bunny card; Deny stops the tool;
  - no answer by the end of the reply means deny;
  - a crashed prompt tool means deny (spike);
  - a read of the data folder or a Bunny-deny path is refused even with an engine allow-all rule set in Settings;
  - the hook killed means the run is stopped by the watchdog.
- **Codex with the option off:**
  - every command reaches a card;
  - a patch to the data folder is auto-declined;
  - a command naming the data folder is flagged;
  - "Allow for this chat" happens only from a click.
- With the option on (the default), everything behaves as before this change.
