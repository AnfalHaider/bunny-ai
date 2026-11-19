# S2-account (the part that needs no real sign-in) and the real-binary smoke for Codex local mode

Run 2026-11-19 by Builder C with the pinned Codex 0.170.0 (win32-x64, Authenticode `OpenAI OpCo, LLC`), an isolated `CODEX_HOME` per run under a scratchpad folder, an invented project, an invented `auth.json` (an unsigned made-up JWT, `invented@example.test`) and a logging HTTP proxy. **No account, no real token, no real sign-in.** Drivers: `s2acct.mjs`, `cx-smoke.mjs` (not shipped).

## S2-account, items that can be checked without a login

| Item | Observed |
|---|---|
| (3) Windows credential store | `cmdkey /list` filtered for codex/openai: **empty before and after**, with `cli_auth_credentials_store = "file"`. Nothing written. |
| (5) Sign-in state through the CLI's own status (`account/read {refreshToken:false}` over `app-server`, no read of `auth.json` by Bunny) | **Signed out** (no file): `{ account: null, requiresOpenaiAuth: true }`. **Garbage file**: the same (treated as signed out). **An invented file**: error `workspace routing discovery failed` (Codex tries to reach chatgpt.com / auth.openai.com to validate the workspace; the proxy refused). So with a real login and a network the call can answer; offline or blocked it answers an error, which Bunny must show as "can't tell" and never as signed in. |
| (6) `account/logout` | Returns `{}`, **`auth.json` is gone**, and `account/read` then says signed out. No keyring entry involved. |
| (4) Hosts contacted at a logging proxy | `account/read` alone contacted `github.com`, `chatgpt.com` and `auth.openai.com`. `github.com` is plugin/app discovery: the CE-1.14 features-off config (already in Bunny's per-run `config.toml`) must be present for account runs; this spike did not pass it, so the host list for a real account run (R28) is **still to be shown with the owner's test account**. |
| (1), (2), (6 next-run message) | **Not shown, needs a real login:** that `app-server` reads the file login and runs a turn under `untrusted`, that CE-1.12 to CE-1.17 hold in account mode, and the "Sign in again" text after logout. These need the throwaway account the owner provides, signed in by the owner. |

**Verdict:** Codex account mode stays greyed ("still being tested"). Nothing found here argues against it: the file store works with no keyring entry, signed-out and logout behave as the spec needs. The remaining items need the owner's test account.

## Real-binary smoke: Codex local mode (Bunny's Responses translator and endpoint, scripted Chat upstream)

- **Text only:** session, text, usage, done. The tool list Codex offered was `exec_command, write_stdin, request_user_input, apply_patch` (the expected set; the endpoint's tool-list check passed).
- **A command, declined on the card:** `Run: powershell.exe -Command 'echo RAN > ran.txt'` reached the bridge, the person said no, the tool ended "Not allowed.", the model carried on, `ran.txt` absent.
- **A command, accepted:** it ran (`ran.txt` present) and the run finished, **but the command took 189 to 256 s to start** in the unelevated Windows sandbox on this PC: `.sandbox/sandbox.log` shows `START: powershell.exe -Command ...` and then minutes of nothing. Each chat has a fresh `CODEX_HOME`, so it repeated on each run. Cause UNKNOWN (PowerShell cold start under a restricted token, or real-time scanning; not Bunny's code). Bunny's 10-minute silence limit covers it and Stop still works; **the person will wait minutes before the first command of a Codex chat.** Worth a note in the help text, and a look on the owner's PC.

## Real-binary smoke: Claude Code local mode

See `../s1/ER-4-prompt-tool.md`, finding 3: Bunny's Messages translator drove the real 2.1.311 binary end to end.

## Why Codex's first command took 3 to 4 minutes, and the fix (measured 2026-11-19)

| Run | First command | Second command |
|---|---|---|
| fresh `CODEX_HOME` (every chat today) | **188 s** | 1 s |
| the same `CODEX_HOME` used again (a different project folder) | 1 s | 1 s |
| a fresh `CODEX_HOME` seeded with `cap_sid` and `.sandbox_migration` from an earlier home | **1 s** | 1 s |

Cause: the unelevated Windows sandbox makes a **capability SID per `CODEX_HOME`** (the `cap_sid` file) the first time a command runs and grants it access: `codex.exe` burns CPU (about 85 s of CPU in the first 90 s) while PowerShell itself starts in 0.3 s. Not PowerShell's cold start, and not Defender (`MsMpEng` was not the busy process). It is per home, not per project folder. Each chat's fresh SID also leaves its own grants on the project folder.

Fix built (`src/server/engines/sandbox-seed.js`): after the first Codex run, the two identity files are kept once under `engines\codex\sandbox-seed` and copied into each new chat home. Nothing else is shared (no config, state, logs or sign-in), the seed goes with the engine on Remove, and a second home never replaces it. The very first Codex chat on a PC still waits once. **For Security:** the seed makes every Codex chat use one capability SID instead of one each. It is not a credential, but it is one shared identity for the sandbox of every chat: please say if that crosses CE-3. (A one-time warm-up at download time would remove even the first wait; not built.)
