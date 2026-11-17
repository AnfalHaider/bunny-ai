# QA live check of kit 0.6.0 on main 9c5ac84 (2026-11-17)

Done from the QA worktree on a new branch cut from `origin/main` at 9c5ac84, with the installed 0.6.0 guard and hooks.

| Check | Result |
|---|---|
| `bootstrap brief qa` | prints the QA brief (job, never, kit, flow, 12 rules, who I report to) |
| `bootstrap status` | `role: qa`, `policy: live=main dev=main`, `hooksPath` is the repo `.githooks`, sign-offs listed (kit-land@da999b0 and others) |
| Docs write with the Write tool | this file: allowed, no wrong refusal |
| Ordinary commands used to get here | `git fetch`, `git checkout -b`, `git rev-parse`, `git log`, `node .bootstrap/bin/bootstrap.mjs ...`: all allowed |
| `git add` of the exact path and `git commit` | see the commit that carries this file |

Nothing was refused wrongly. Not covered here: the 6 s guard deadline under heavy load (see the kit-land sign-off).
