# Q1 research: computer use and plugins/marketplaces

Researcher, 2026-11-16, read-only. Code checked at `8f01146` (initial-import). Nothing was run against live or the real profile.

## Headline

**The question's premise is out of date.** Board Q1 and `docs/STATUS.md:44-45,88-89` say both rows are open "on purpose" (72 of 74). The code says otherwise:

- `docs/features.js:111,114` marks **6.7 Computer use** and **6.10 Plugins and marketplaces** as `D` (done, covered by a test). `grep -c "status: 'D'" docs/features.js` gives 116; `'P'` or `'M'` rows give 0.
- Both named tests exist and pass: `node --test test/plugins.test.js test/agent-tools.test.js` gives 13 pass, 0 fail.
- STATUS.md still prints "Tally 82/84 ... stay open on purpose" (line 158) and "not done, on purpose" (lines 88-89). The two lines contradict `features.js` and the code. The code was added on 2026-11-15 (`440b840`, `ef68944`) after the first note was written.

So the owner is being asked to choose about features that already exist. The real decision is whether to **keep them, narrow them, or switch them off**, and to fix the docs.

## Computer use: what it does today

| Fact | Where |
|---|---|
| Windows only. Runs PowerShell (`-ExecutionPolicy Bypass`) with `System.Windows.Forms` and `SendInput`-style code to take screenshots, click, scroll, type and press keys | `src/server/computer.js:36-217` |
| Model tools: `computer_screenshot`, `computer_click`, `computer_type`, `computer_key`, `computer_scroll` | `src/server/agentTools.js:76-85` |
| Risk levels: screenshot is `read`; click, type, key and scroll are `build` | `src/server/agentTools.js:20` |
| Off unless `aiComputerUse === true` and `process.platform === 'win32'` | `src/server/app.js:1539` |
| Plan mode offers only the read-risk tool (screenshot) | `src/server/app.js:1583`; `test/agent-tools.test.js:24` |
| The model can ask for the capability (`request_capability`); the person must agree. It is not turned on without that | `src/server/app.js:1691-1713`; `test/agent-tools.test.js:211-218` |
| Settings switches: `computerUseEnabled` (the HTTP routes) and `aiComputerUse` (default off) | `src/ui/settings.html:302,309` |
| HTTP routes `/api/computer/*` return 403 when `computerUseEnabled === false` | `src/server/app.js:947-949` |
| Helper agents never get it (`n.startsWith('computer_')` excluded) | `src/server/app.js:1763` |

**Gaps and risks (facts, not decisions):**

1. **Test coverage is thin.** The one test the tally names (`test/agent-tools.test.js:30`) checks only that screen text is placed at the centre of each line. Nothing tests click, type or key against a real or fake desktop. The tally's "D" overstates it. This is UNKNOWN until someone runs it on a throwaway Windows session; I did not run it, because it would drive the real desktop.
2. **`computerUseEnabled` defaults to `false` in the UI** (`src/ui/chat.js:59`). The server check `settings.computerUseEnabled === false` blocks only the HTTP routes, not the model's tool path, which is gated by `aiComputerUse`. Two switches with different scope is confusing; I did not verify what the default is in the stored settings.
3. **Per-action approval depends on permission mode.** Click, type and key are `build` risk. Whether each one asks the person depends on the mode chosen (`src/server/app.js` around 1583). I did not trace every mode.
4. **No OS entitlement is needed on Windows.** The "entitlement" in STATUS is a macOS idea. On Windows the PowerShell route works without one, so that reason for staying open no longer applies.
5. **`width: 0, height: 0` is returned from `screenshot`** (`src/server/computer.js`, `screenshot`), so the HTTP route reports no size. The model path uses `capture()` instead (`src/server/app.js:2118`).

## Plugins and marketplaces: what it does today

| Fact | Where |
|---|---|
| A plugin is a GitHub repo. Bunny reads its skills (`SKILL.md` plus `references/`) and `.mcp.json` remote connectors | `src/server/pluginImport.js:1-100` |
| Hooks, commands, agents and scripts are **listed as skipped and never run** | `src/server/pluginImport.js:9-10,89-91` |
| Local connectors (a program with a command) are skipped on import; adding one needs `add_connector` and the person confirming the exact command | `src/server/pluginImport.js:75-86`; `src/server/app.js:811,2225-2229` |
| Install route `POST /api/plugins/install`; the model tool `install_plugin` is `edit` risk, so it follows the permission mode | `src/server/app.js:915-921`; `src/server/agentTools.js` and `src/server/appTools.js:10` |
| Search (the "marketplace"): GitHub repository search plus the official MCP registry. No curated catalog | `src/server/pluginImport.js:106-135` |
| Install is recorded in `settings.plugins`; Uninstall removes everything the plugin added as one | `src/ui/customize.html:13,211,289`; test `test/plugins.test.js:37` |

**Gaps and risks:**

1. **"Marketplace" is a search box, not a store.** There is no curated list, no ratings, no trust labels, no versions, and no update check. Results are sorted by GitHub stars (`pluginImport.js:111`), which anyone can game.
2. **Skills are third-party text the model follows.** No code runs, but a skill can instruct the model to run commands through `code_mode` or other tools. This is a prompt-injection surface that the "never runs code" claim does not remove. UNKNOWN: whether installed skills are shown to the person in full before they switch on. Security should review this.
3. **No pinning.** The install reads the repo's default branch at the moment of install (`pluginImport.js:35-37`); there is no commit sha recorded, so "update" and "what changed" cannot be answered. I did not check whether `record` stores a sha.
4. **GitHub API is unauthenticated** (`pluginImport.js:111`), so it is rate-limited (60 requests per hour per IP, from GitHub's public documentation, not tested here).
5. STATUS.md's "this app runs no third-party code" is true only for hooks and scripts. Local connectors do run a program once the person confirms the command.

## Options for the owner

| Option | What changes | Trade-off |
|---|---|---|
| **A. Keep both as built, correct the docs (recommended)** | Fix STATUS.md and Q1 so they say 84 of 84 (or 116/116 rows) and describe the real safeguards. Ask Security to review the two risks above. Ask QA for a real Windows test of computer use on an invented-data desktop. | Cheapest and honest. Leaves the thin test coverage and the skills risk as named follow-ups. |
| **B. Keep, but harden first** | A plus: add a visible confirmation for every `computer_*` action regardless of mode; record the commit sha on install; show a skill's full text before it switches on. | Safer. About three small builds; touches the permission path, so HIGH risk under AGENTS.md. Needs the owner's go. |
| **C. Switch both off by default and hide the settings** | Remove or hide the toggles and the install tool. | Matches the old "on purpose" stance. Throws away working, tested code and a feature the owner may now rely on. |

**Recommendation: A now, then B as separate rows** if the owner wants computer use used on the real machine. If the owner says keep them open, the answer is C, and the old documents then need to say so correctly.

## What I did not verify

- I did not run computer use, since it drives the real desktop.
- I did not look at the live GitHub or MCP registry responses.
- I did not read the 2026-11-15 commits in full. Dates come from `git log -S`.

## Evidence

```
git log --oneline -3 initial-import     8f01146 Roster ... / 06b06b4 / d5c8453
grep -c "status: 'D'" docs/features.js  116   (P or M: 0)
node --test test/plugins.test.js test/agent-tools.test.js   tests 13, pass 13, fail 0
git log -S"pluginImport"                ef68944 2026-11-15
git log -S"computerUseEnabled"          09e3448 (first added)
```
