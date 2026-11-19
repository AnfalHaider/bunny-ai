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

## Revision after the owner's answer (2026-11-19): Bunny's deny rules follow the engine

The Chief of Staff asked: "Should your Bunny Deny rules stay in force when Bunny's engine is off? Yes, keep them (recommended), or have them follow the engine." The owner answered, typed in the Chief of Staff's chat:

> "Follow the engine"

**ER-3.1, revised.** While "Use Bunny's engine" is off, **the person's Bunny deny rules aren't carried** into the engine's settings, and Bunny doesn't enforce them on engine tools. The engine's own rules, set in Settings → Engines (ER-2), decide.

**The fixed floor stays, because it isn't the person's rules.** It protects Bunny itself and the other engines' sign-ins:
- Bunny's data folder and DPAPI key store;
- every engine home and its credentials;
- the person's real `~/.claude`, `~/.codex`, `~/.cline` and `~/.aider*`;
- the key folders (CE-1.6);
- `%APPDATA%` and `%LOCALAPPDATA%`.

It's still written as the engine's deny rules, and enforced by Bunny where it sees the call.

**Following from that:**
- **ER-5, Claude Code.** CE-1.7's hook enforces the floor only. CE-1.9 copies only the floor into `permissions.deny`.
- **ER-5, Codex.** CE-1.13: Bunny auto-declines a patch only to a **floor** path, and flags in red a command naming a floor path. Patches to paths in the person's own deny rules go to the person's card like any other.
- **ER-6, the warning, revised** (shown when the option is turned off, and kept on the Engines page):

  > **Bunny's engine is off.** Chats run on <engine> and follow <engine>'s rules, which you set here. Bunny no longer checks each step against your Bunny rules, including your Deny rules: <engine> asks you itself, and Bunny shows its questions. Bunny still blocks its own data, its keys and the engines' sign-ins. A command you allow can read any file on this PC that you can.

- **Settings → Rules** (Bunny's own rules page) shows one line while the option is off: "Not used while Bunny's engine is off. <engine>'s rules apply." That way the person isn't left believing a deny rule still protects a file.
- **ER-7, tests, revised:** with the option off, a path covered only by a Bunny deny rule reaches the engine's own decision (an allow or a card), and a floor path is still refused. With the option on, Bunny's deny rules apply as before.

## Build review at 570b987 (claude/builder-c-v0114-engines): PASS against ER-1 to ER-7

I read the diff 6c3ed0d..570b987:
- `approve-server.js`;
- `bridge.js`: `floor`, `floorOnly` and `relay`;
- the Claude Code adapter, the service, `app.js`, `remoteAccess.js` and `windowOnly.js`;
- the UI warning;
- the ER-4 spike (`docs/spikes/cli-engines/s1/ER-4-prompt-tool.md`, run on the real Claude Code 2.1.311).

On an extract of 570b987, the `engine-*` files (with the new `engine-rules`) pass **144 of 144**.

- **ER-1, the option.**
  - `useBunnyEngine` is window-only, and `deviceRefusal` refuses it to every device, including Everything. That closes EN-5.
  - Turning it off is refused (409) unless a downloaded, enabled engine with its own rules exists. Each change is recorded (`rules-on` / `rules-off`).
  - A chat's rules are fixed at its first message (`rulesFixed`).
  - Engine rules apply only in **full mode**. A restricted run keeps Bunny's rules and the diff review.
- **ER-2, rules set in Bunny only.**
  - The engine's rules are `{allow, ask, deny}` lists in Claude Code's pattern form, edited in Settings under `engines.claude-code.rules` (which falls under the device refusal).
  - `cleanRules` and `validateRules` accept only `Tool(…)` patterns, at most 200 rules of 200 characters, never `mcp__bunny__*`. There's no `defaultMode` or bypass key, so no bypass or auto-approve mode can be set.
  - `--setting-sources user` stays, so a project's `.claude` still never loads. Codex has no editable rules: every step goes to a card.
- **ER-3, the floor.**
  - With the option off, `denyRules` gets **no** person rules, but still writes the floor (data folder, engine homes, key folders, in both proven forms) into `permissions.deny`.
  - The hook runs `floorOnly`, which denies the floor and Bunny's own tool and otherwise prints `{}` ("no opinion"), so the engine's rules decide.
  - Commands naming a floor path are flagged, not decided. Spike line 4: a floor deny beats an owner allow rule **and** a prompt-tool Allow.
  - CE-1.14, the watchdog, the process rules and the budget are unchanged.
- **ER-4, questions to the person.**
  - Claude Code uses `--permission-prompt-tool mcp__bunny__approve`, with a per-run server under the CE-4 rules. Only a well-formed request reaches `decide`, which runs the floor first, then a card naming the engine.
  - No answer within 150 s, a throw, a closed server or a killed engine all mean deny. `MCP_TOOL_TIMEOUT=200000` keeps Claude Code from ending the wait at 60 s, a finding from the spike.
  - The model can't call the prompt tool: it isn't in the model's tool list (spike line 3), and the floor denies `mcp__bunny__*` too.
  - `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode` are disallowed in this mode, so the expected tool list holds.
  - **Codex:** `untrusted` is kept. Every command goes to a card through `relay`, and a patch to a floor path is declined. `acceptForSession` isn't offered yet: "Allow for this chat" comes next, and it's click-only per ER-4.
- **ER-6:** the warning is word for word as revised, and the Rules page shows "Not used while Bunny's engine is off. <engine>'s rules apply."
- **Noted (EN-4 class, LOW):** `BUNNY_APPROVE_TOKEN` is in the engine's environment, so an allowed command could send a fake question to the approve server. That only shows the person a card whose answer nothing uses. Accepted.

Verdict: PASS at 570b987. **"Allow for this chat"** (Codex `acceptForSession`) needs its own short review when it lands. It must come only from the person's click, and must last only for that chat.
