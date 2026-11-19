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
