# Spike S-F13B: Codex command/exec as a write confinement for Bunny's commands

Run 2026-11-24 on the pinned Codex 0.170.0 (sha256 b1634415...a158, checked against pins.json), offline, no model, no account, no sign-in. Owner's word: "Yes, download both" (plan doc on main). Runner: `scripts/canary-engines.mjs`; raw: `docs/security/canary-2026-11-24.json` (key `sF13B`).

## Method
`codex app-server` over stdio, `CODEX_HOME` = a scratch folder under the worktree (not in %TEMP%) with `[windows] sandbox = "unelevated"`. After `initialize`/`initialized`, five `command/exec` calls with cwd = the project folder, each running PowerShell `Set-Content`/`Get-Content`. A first attempt used `cmd /c echo > "path"` and failed for quoting reasons on every path with a space, so those results were thrown away and the spike rerun.

## Results
| Step | Policy | Exit | Seconds | Message |
|---|---|---|---|---|
| write inside the project, workspaceWrite policy (first command: sets up the sandbox identity, can be slow) | workspaceWrite, writableRoots = [project], network off | 0 | 3 |  |
| write outside the project, workspaceWrite policy (expect refused) | workspaceWrite, writableRoots = [project], network off | 1 | 0.7 | Set-Content : Access to the path 'D:\Projects\OPEN CODE PROJECTS\BUNNY-AI\.claude\worktrees\builder-efa9a9\docs\security\canary-out\f13\outside\outside.txt' is  |
| read outside the project, workspaceWrite policy (reads are not stopped) | workspaceWrite, writableRoots = [project], network off | 0 | 0.5 | MARK_ROOT_CLAUDE_MD  |
| write inside, readOnly policy (expect refused) | readOnly | 1 | 0.5 | Set-Content : Access to the path 'D:\Projects\OPEN CODE PROJECTS\BUNNY-AI\.claude\worktrees\builder-efa9a9\docs\security\canary-out\f13\project\ro.txt' is denie |
| write outside with NO sandboxPolicy (the configured default) | none (configured default) | 1 | 0.5 | Set-Content : Access to the path 'D:\Projects\OPEN CODE PROJECTS\BUNNY-AI\.claude\worktrees\builder-efa9a9\docs\security\canary-out\f13\outside\default.txt' is  |

Files afterwards: {"project/inside.txt":true,"outside/outside.txt":false,"project/ro.txt":false,"outside/default.txt":false}.

## What it shows
- A write inside the project folder works under workspaceWrite; a write outside it is refused by the OS ("Access ... is denied"). Reads outside the project are not stopped (another folder's CLAUDE.md was read), as the plan already says.
- A readOnly policy refuses a write inside the project.
- With no sandboxPolicy the call still ran confined: a write outside the project was refused (the configured default, unelevated, applied).
- The first command in a fresh CODEX_HOME took 3 s here, not the minutes seen in the earlier engine spike.
- Not tested: a command that spawns a child, long-running or streaming commands (command/exec/write), junctions or symlinks out of the project, a drive-root or home writableRoots (Bunny must never pass these), and the network (the policy said off; nothing tried to connect).
