# CLI-ENGINES build review (Security), commits 02808a5..02fae7a: FAIL at 02fae7a for EN-1, the rest pass

Branch claude/builder-c-v0114-engines, from main ca501c9. I read every file under `src/server/engines/` at 02fae7a and the device diff of 02808a5:
- in full: the hook script, bridge server, Claude Code and Codex adapters, and the process code;
- the key checks in the endpoint, store, unpack, staging and bridge.

On an extract of 02fae7a with an invented profile, the 10 `engine-*` test files pass **101 of 101**. The app.js integration and the UI aren't built yet.

## Commit by commit

| Commit | Piece | Verdict |
|---|---|---|
| 02808a5 | `deviceRefusal` (CE-6) | **PASS.** Refused to every device, Everything included: `/api/remote*` and `/api/engines*`, the `engine` and `engines` settings, `session.engine` in POST and PATCH, and `/setting/engine`. Checked in `remoteRoute`, the belt in `route`, and the body handlers (before `remoteBody` and `remotePatch` drop keys). The engine keys and routes are also window-only. |
| dcac679 | events, bridge, store, unpack, schema | **PASS.** The bridge judges in the CE order: unknown tools are run; a read outside the folder is an Ask in every mode; protected and key folders refused; a command naming a protected folder refused. The store: every file's sha256 is checked **before** unpacking; HTTPS with manual redirects checked hop by hop against the pin's hosts; signature and `--version` checked; `current.json` written atomically. Unpack refuses absolute paths, drive letters, `..`, `:`, reserved names, links (zip mode bits, tar types), more than 2 GB, and entries larger than declared. |
| 8766d44 | endpoint, Responses translator | **PASS.** 127.0.0.1 on port 0; exact Host; refuses any Origin and any `sec-fetch-*`; token in Bearer or `x-api-key`, compared timing-safe; only the three paths; at most 4 at once; upstream error text through `looksSecret`; the CLI's model name ignored. |
| 81c9dd4 | hook script, bridge listener | **PASS.** The hook prints deny on every path it can reach: no or bad port or token, unparseable stdin, no `tool_name`, an unreachable bridge, a non-200 response, a bad body, its own timeout, uncaught errors. It never exits 1. It's run as Bunny's runtime plus an absolute script path, rewritten each run, and its sha256 is checked. The listener follows CE-4. The Ask limit (10 min) sits under the hook's own (11) and Claude Code's (12). |
| 5a35e7a | Claude Code adapter, fake engine, watchdog | **PASS, with EN-3 required before it ships.** `--permission-prompts none`, `--setting-sources user`, `--strict-mcp-config`, `--disallowedTools`, Plan, `--restricted`; settings with the hook on `*` and `permissions.deny` only (no allow, no ask); read-Ask paths go into deny (CE-1.9 ruling). Home, HOME, USERPROFILE and APPDATA are isolated. The prompt goes in on stdin. The tool list is checked at `system/init`. The watchdog trips on a `tool_result` the hook never asked about, or with no `tool_use`. Processes start by absolute path with a minimal env and are killed as a tree. |
| a24599e | staging, restricted mode (CE-2) | **PASS.** The copy leaves out hidden and denied paths, the data folder, engine homes, `.git`, the engine config folders and every link (via `lstat`). The diff finds adds, changes, deletes, links and type changes. It discards links, type changes, config folders, ADS, reserved names and files over the size limit. Files that run code later always ask, and Plan mode keeps nothing. |
| 02fae7a | Codex adapter (CE-1.12 to CE-1.17) | **FAIL for EN-1.** Everything else holds: `untrusted` (checked against `thread/start`'s answer), no experimentalApi, accept or decline only, legacy and permission approvals declined, CE-1.14 features off, the config rewritten with the project untrusted, the unelevated sandbox, the tool list checked at the endpoint, server requests and notifications checked against the pinned schema. |

## Findings

**EN-1 (MEDIUM, required): the Codex watchdog misses a declined command that runs anyway.**

In `createCodexDriver.onItem`, a completed item trips the watchdog only if it is in **neither** the accepted nor the declined set: `ran && !accepted.has(id) && !declined.has(id)`. A command Bunny **declined** that Codex reports as `completed` or `failed` (it ran) is shown as "Not allowed" and the run continues. That's exactly the case CE-1.17 exists for.

The `outputDelta` check catches it only when the command printed something.

Probe (`docs/security/engines-probe/codex-declined-ran.mjs` on 02fae7a):

    declined command reported as completed: watchdog did NOT trip

**Fix:**
- Trip when `ran && !accepted.has(item.id)`: declined plus ran is a violation.
- Only an item whose status is `declined` (or that never ran) counts as declined.
- Add the probe's case as a test.

**EN-2 (LOW): the CE-1.15 check after the run is missing.**
- `configToml` writes the untrusted entry with a lowercased key, and the whole file is rewritten every run. So a `trusted` entry Codex adds (for example under a different spelling of the path) is gone before the next run.
- S2's addendum showed no entry also means not read. So nothing is open.
- CE-1.15 asked for a check after the run that the entry still says `untrusted`, and a log if not. Add it, so a change in Codex's behaviour is noticed.

**EN-3 (MEDIUM, required before Claude Code ships): absolute deny paths aren't proven.**
- `denyRules` writes the floor as `Read(//C:/…)` and `Edit(//C:/…)`.
- S1 proved a `permissions.deny` rule for a **workspace-relative** file (`secret.txt`) with the hook killed. It didn't prove the Windows **absolute** form for the data folder, engine homes or key folders.
- If Claude Code reads that form differently, the floor rests on the hook and the watchdog alone.
- **Fix:** add a spike line (or an `engine-smoke` step on the pin). With the hook killed and `--permission-prompts none`, a `Read` of a file in a fake data folder outside the workspace, named only by an absolute `//C:/` deny rule, must be refused.

**EN-4 (LOW, noted): run tokens reach the engine's own commands.**
- `BUNNY_BRIDGE_TOKEN`, `BUNNY_ENGINE_TOKEN` and `ANTHROPIC_API_KEY` (the endpoint token in local mode) are in the engine's environment, so a command the person allows inherits them.
- That command could call the endpoint (spending within the run's `replyCaps`, like the engine itself) or call `/decide` (which can't make the engine allow anything, and can't guess future `tool_use` ids).
- It's accepted for now. If an engine later offers a way to keep variables from its child processes, use it.

**EN-5 (for the next commits):**
- When ENGINE-RULES' "Use Bunny's engine" option is added, its key must be inside `deviceRefusal`. `engines.*` covers it if it sits under `engines`.
- I'll review the app.js integration and the UI against CE-6, CE-7, ER and the `replyCaps` rule (CE-4.5).

## Verdict

**FAIL at 02fae7a, for EN-1.** EN-3 must close before Claude Code ships. EN-2 is LOW. Commits 02808a5 to a24599e pass.

## Re-review at 37746e5 (fixes 656d66c and 37746e5; also new: pins 498025d, app integration cc231ad, Settings UI 6a35533): FAIL, for EN-6 and EN-7

**Fixed:**
- **EN-1:** `onItem` now trips on `ran && !accepted.has(id)`. My probe on 37746e5 says `declined command reported as completed: watchdog TRIPPED`, and `engine-codex-watchdog` has the case.
- **EN-3, a real bug the spike found** (S1 addendum 4, 84eaaea, I read it):
  - `Read(//C:/…)`, the form the first build wrote, **doesn't** deny on Windows, even with the hook killed;
  - `Read(//c/…)` and `Read(C:/…)` do, and still win over a live hook's allow.
  - `denyRules` now writes both working forms for every absolute floor path, and never `//C:/`. The proof used a folder inside the project, named only by its absolute path, so it tests the form itself.
- **CE-1.7 hardened:** the hook's write timers now exit **2**, which blocks, with the reason on stderr. It exits 0 only after its answer is written. There's a test with a stdout that never drains.
- **CE-1.11:** the timeouts are the proven 300 s for the hook and 150 s for an Ask. The Ask still ends before the hook does.
- **Codex:** the project key uses `realpath` (8.3 names and case). Account mode keeps its credential in a file inside the isolated home (`cli_auth_credentials_store = "file"`), never the system store.
- **Tests:** on an extract of 37746e5, the `engine-*` files (now with `engine-events`, `engine-env`, `engine-app` and `engine-pins`) pass **121 of 121**.

**New findings in the app integration (cc231ad):**

**EN-6 (MEDIUM, required, CE-4.5): engine runs aren't held to the owner's spending limit.**
- In `app.js`, `engines.runTurn` gets `noteUsage: () => {}`, and `service.js` passes no `replyCaps`, `tokenBudget` or `onLimit` to the endpoint or adapters.
- CE-4.5 requires an engine run to count against the chat's `replyCaps` token budget and to show the existing `onLimit` card when it's reached, so an engine can't spend past what Bunny's own engine could in the same chat.
- **Fix:** have the endpoint count tokens per run. When the budget is reached, stop forwarding and ask through the existing `onLimit` card (no answer means stop). Test it with the fake engine.

**EN-7 (MEDIUM, required, CE-6.2 / CE-7.2 / R-DF2): an Everything device's engine tools aren't logged.**
- The engine branch runs for `req.bunnyDevice` (an Everything device), but nothing calls `remote.logAction` for the engine's tools. Bunny's own `runTool` does.
- **Fix:** for a device chat, log every engine tool the bridge sees (and each restricted-mode change applied) as `{kind: 'tool', tool: '<engine id>:<mapped name>'}`, by name only. Test it at Everything over HTTP.

**Notes (not blocking):**
- After a watchdog trip, the chat continues in restricted mode automatically (`session.engine.restricted`). That's the safer default and is said in the reply, so it's accepted in place of the "offer" CE-1.10 described.
- `keyFolders` names `~/.aider`. Aider's own files are `~/.aider*` (for example `.aider.conf.yml`). Cover the prefix when Aider is built.
- The pins file and gate step (498025d) and the Settings UI (6a35533) have no security issues on a first read. I'll read the UI fully with the ENGINE-RULES option (EN-5).

**Still to come, as the Chief of Staff said:** EN-2 (the CE-1.15 check after the run) and EN-5 (the ENGINE-RULES option key inside `deviceRefusal`).

## Verdict

**FAIL at 37746e5, for EN-6 and EN-7**, both in the integration. EN-1 and EN-3 are fixed, and the engine core passes.

## Re-review at e78209b (41e3335 EN-2, bfc6c23 the engine chip, e78209b EN-6 and EN-7): PASS for the engine core and integration so far (supersedes the FAIL at 37746e5)

- **EN-6 fixed (CE-4.5).**
  - `budgeted()` wraps the endpoint's upstream for the run. Before each upstream call it checks the tokens used against `replyCaps.tokens`. At the budget it asks through `onLimit`, which uses the existing question card. No answer or "Stop here" stops the run, and nothing more is forwarded. "Keep going" raises the budget by one step.
  - Test: `engine-app` "EN-6 (CE-4.5)…".
  - **Limits, accepted:** the check is per upstream call, so one long stream can pass the budget by its own size, as with Bunny's own engine. Account mode isn't counted, because the vendor bills those runs (§7.1).
- **EN-7 fixed (CE-6.2, CE-7.2, R-DF2).** `logTool` is set only for `req.bunnyDevice`, and every `tool-start` logs `<engine>:<mapped name>`, by name only. Test: `engine-device` at Everything over HTTP.
- **EN-2 fixed (CE-1.15).** After a run, `ensureUntrusted` rewrites the config if any `trust_level = "trusted"` appears, and the reply says so. There's a test with a fake Codex that marks the project trusted.
- **Also:**
  - `writeReal` refuses a path outside the workspace root;
  - `checkPins` checks the npm integrity format (`sha512-<base64>`);
  - the watchdog note says a new chat starts in full mode.
- **The engine chip (bfc6c23):**
  - The engine can be chosen before the first message. After it, a PATCH `engine` gets 409.
  - A device's PATCH `engine` is still refused by `deviceRefusedBody`, at every level.
  - `session.engine = {id:'bunny'}` is accepted as an explicit choice of Bunny's engine. The chip is built from the window-only `/api/engines` list.
- **Tests:** the `engine-*` files pass **125 of 125** on an extract of e78209b.

Verdict: PASS at e78209b for the engine build so far. **Still to come:** ENGINE-RULES with EN-5 (its option key inside `deviceRefusal`), and Aider when it's built (`~/.aider*` in the key folders).

## Re-review at 6c3ed0d (7028f7b LOWs, fe90806 account sign-in, 6c3ed0d Messages translator): PASS (supersedes e78209b)

- **fe90806, Claude Code account sign-in and sign-out (CE-3, spec §7.1).**
  - **Sign-in** spawns the pinned `claude.exe` by absolute path with the fixed arguments `auth login`. It runs in a visible, detached window, with `minimalEnv()` plus only the account folder's variables (`CLAUDE_CONFIG_DIR`, HOME, USERPROFILE, APPDATA, LOCALAPPDATA under `<data>\engines\claude-code\account\home`).
  - **State** comes from `auth status --json`. Bunny keeps only the boolean `loggedIn`: the output is read into memory, at most 4,000 characters, and thrown away. Nothing is stored or logged, and no credential file is opened.
  - **Sign-out** runs the vendor's `auth logout`, then deletes the account folder. It refuses while a run is going.
  - **The account folder** sits under the data folder, so the floor (`protect: [dataDir]` and the `//c/` and `C:/` deny forms) keeps every engine tool out of it. Account runs use it as `CLAUDE_CONFIG_DIR`.
  - The routes `/api/engines/<id>/signin` and `/signout` are window-only and refused to every device (`deviceRefusal`). Both actions go in the record. A signed-out account chat stops with guidance.
- **6c3ed0d, the Messages translator for local mode.**
  - `/v1/messages` and `/v1/messages/count_tokens` join the endpoint's path list, behind the same Host, Origin, Sec-Fetch and token checks (CE-4).
  - The tool list in each Messages request is checked against Claude Code's expected set; anything extra is refused.
  - Errors go through `safeMessage`, and the upstream is `budgeted()`, so EN-6 holds in local mode too.
  - `count_tokens` is an estimate that reaches no provider.
- **7028f7b:**
  - pins can carry `entrySha256`, so the program itself is hash-checked at install;
  - `checkPins` checks that licences are listed in About;
  - Remove and Roll back use Bunny's own confirm card;
  - a device page shows "Only Bunny's window can change engines.";
  - the rest is UI and CSS.
- **Tests:** the `engine-*` files pass **134 of 134** on an extract of 6c3ed0d. 7028f7b and e78209b are both ancestors.

Verdict: PASS at 6c3ed0d. Still to come: ENGINE-RULES with EN-5.

## Review of 988e07c ("Allow for this chat"), a9e3cf9 (Codex sandbox seed) and 8bcf527 (merge of claude/v0114-integration ba6f461): FAIL at 8bcf527 for EN-8

On an extract of 8bcf527 with the gate's `test/support/no-network.mjs` preload, the `engine-*`, `window-only` and `pc-device` tests pass **165 of 165**.

**988e07c, "Allow for this chat": the code is right; EN-9 must be answered before the button ships.**
- The third button appears only when the card itself carries `forSession`. The server turns an answer into `'session'` only if that pending card was opened with `forSession`. The service offers it only with Bunny's engine off (`ownRules`) **and** for Codex. `codex.js` sends `acceptForSession` only when the bridge's verdict says `forSession`, which comes only from that click. Claude Code never offers it. Tests are in `engine-rules`.
- **EN-9 (MEDIUM, required before the button ships):** what Codex 0.170.0 does **after** `acceptForSession` isn't proven.
  - If it stops sending `requestApproval` for later commands or patches, the CE-1.17 watchdog (`ran && !accepted`) trips on the next one and stops the run. That fails safe, but the feature then doesn't work.
  - Worse, an approval Bunny never sees would skip the floor check that declines patches to a floor path. The unelevated sandbox would still confine writes to the workspace.
  - **Needed:** a spike line on the real Codex showing exactly which later items skip the approval after `acceptForSession` on a command and on a patch. The watchdog and the floor then follow that scope: Bunny records the session-accepted scope and never auto-accepts a floor path. **Until then, hide the button.**

**a9e3cf9, the shared sandbox identity: EN-8 (MEDIUM, required).**
- The seed copies one `cap_sid` into **every** Codex chat home, so every chat's sandbox runs as the same capability SID.
- Codex grants that SID write access to each chat's workspace. With one SID, a sandboxed command in a chat on project B can write into project A, which an earlier chat granted.
- This doesn't touch CE-3, since there's no credential in these files. It weakens **CE-1.16's second wall** (write confinement) across projects. Every command still needs a yes (`untrusted`), so it isn't a hole on its own, but the sandbox exists to hold when a yes was a mistake.
- **Answer to Builder C:** a fresh SID per chat isolates projects, but leaves one more grant on the project folder per chat. One shared SID removes the cost and the clutter, but joins every project together.
- **The fix, and the better of both:** key the seed by the **project's real path**: `sandbox-seed/<sha256 of the canonical root>`. The first chat in a project pays the set-up once, later chats in it are fast, and each project keeps its own SID. That's one grant per project, never across projects. Remove engine removes all seeds. Add a test that two different roots get different seeds.

**8bcf527, the merge: PASS.**
- The four hand-resolved hunks keep both sides:
  - in `app.js`'s settings PUT, the engine device-refusal and validation run before the window-only check, and SEARCH-PC's device refusal and validation follow;
  - `windowOnly.js` and `api.js` carry both the `pcSearch*` keys and `engine`, `engines` and `useBunnyEngine`, plus `engine` in the session list;
  - `app.css` was rebuilt.
- I didn't find a security change in the resolution.

## Verdict

**FAIL at 8bcf527, for EN-8** (key the seed per project). EN-9 must be answered by a spike, or the "Allow for this chat" button hidden, before it ships. The merge passes.

## Re-review at d603917 (c923b65 EN-8, d603917 EN-9): PASS (supersedes the FAIL at 8bcf527)

- **EN-8 fixed.**
  - `seedDirOf(dataDir, root)` is `engines\codex\sandbox-seed\<sha256 of the real, lower-cased project root>`, and the seed is kept and copied per project.
  - Tests show two projects get different seeds, the same project gets the same one, and project B never gets A's. So it's one capability SID per project, never across projects.
- **EN-9 answered by a spike on the real Codex 0.170.0** (`docs/spikes/cli-engines/s2/S2-account-and-smoke.md`, "EN-9", which I read). `acceptForSession` covers **only the exact command text** for the rest of the thread. These are all asked again:
  - other arguments;
  - another program;
  - a command naming the data folder;
  - **every** `apply_patch`, including a floor path given absolute or as `../`.
- **The build matches that scope:**
  - the driver records the exact text granted, and the watchdog counts only an item with exactly that text as covered (anything else unasked still trips);
  - `acceptForSession` is sent only for a command approval, never a patch;
  - a floor-flagged command card, or any patch card, doesn't offer the button;
  - the button shows only where the pin says so (`pins.json` `codex.sessionAllow: true` for 0.170.0), so a new pin must rerun the spike.
- **The stated limit is accepted:** a granted command that reads a floor path through a script, without naming it, can repeat that read without asking. That's the same as a one-off Allow: Bunny can't see what a command reads. The ER-6 warning already says so.
- **Tests:** the `engine-*` files pass **149 of 149** at d603917 on an extract, with the no-network preload.

Verdict: PASS at d603917.
