---
piece: s-3
role: security
sha: 1ec5c64
verdict: PASS
date: 2026-11-17
---

# S-3 at 1ec5c64 (with dadb1fe, the audit-exceptions test): Security PASS, with an honest limit on the shell check

Tests, one file each, from a copy of 1ec5c64 with `NoDefaultCurrentDirectoryInExePath` unset:

| Test file | Pass | Fail |
|---|---|---|
| `s3-secrets` | 4 | 0 |
| `secretStore` | 8 | 0 |
| `audit-exceptions` | 10 | 0 |

dadb1fe is under 1ec5c64.

## File tools: PASS (this is the real control)

`createWorkspace({ protect: [<data>/secrets, <data>/account.json] })` refuses the protected paths for read, write, list and search. It checks both the typed path and the **real** path, and the list and search walkers skip them. The tests cover a junction and a symlink.

My probe `docs/security/s3-probe/fence-probe.mjs` adds one case the tests don't try: the data folder's **8.3 short name** (`BUNNYA~1`) used as a path inside a chat's folder. It is refused, because the real-path check resolves it.

## Shell commands: a speed bump, not a fence (as Builder C noted)

`namesProtected(command)` is a text check. The same probe reads the invented secret with:

```
Get-ChildItem -Recurse -File -Filter "*.s*t" | Get-Content
```

That command names no protected path and no `.secret`. No text check can fence a shell. A command runs as the person, so it can read the secrets folder and the entropy file, and then call DPAPI `Unprotect` itself.

What protects the secrets from commands:
- in Ask mode, the command card the person reads before allowing it;
- in Auto, nothing but the person's own choice of Auto.

**I don't want more pattern matching.** It would only add false refusals. What I do want:
1. Say this plainly in the code and tests. The test name "refused, in any spelling" claims more than it does; rename it "the obvious spellings are refused" and add a comment that the shell check is best effort.
2. Add this sentence to Auto mode's help text: "In Auto, commands run without asking, and a command can read anything your Windows account can, Bunny's saved keys included."

## Secret store entropy: PASS

- A per-install 32-byte value in `secrets/entropy.key` (base64-checked, created once with `wx`) now goes into every DPAPI `Protect` and `Unprotect` call.
- Old secrets (`v` missing) still read, and are saved again as `v: 2`.
- This stops a generic stealer that copies one `.secret` file and calls `Unprotect` with no entropy.
- It does not stop code running as the person, which can read `entropy.key` from the same folder. That is the limit of DPAPI with the CurrentUser scope.

## LOW

The fence covers only `secrets/` and `account.json`. If a chat's folder contains a junction into Bunny's data folder, the tools could still reach the rest of that folder (chats, memory). Picking the data folder itself is already refused (`neverBrowse`). Consider protecting the whole data folder.
