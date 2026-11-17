# W2-9 LOWs at 30d0582: Security FAIL, on one thing (the Git LFS exception); everything else holds

Tests from a copy of 30d0582, with `NoDefaultCurrentDirectoryInExePath` unset:

| Test file | Pass | Fail |
|---|---|---|
| `w29-lows` | 3 | 0 |
| `s3-secrets` | 5 | 0 |
| `w6-11-compare` | 6 | 0 |
| `w2-9-worktree` | 12 | 0 |
| `w29-safe-exec` | 4 | 0 |

## What holds

- **procGuard:** `taskkill` runs by its full path, with no shell and the safe environment.
- **The compare** resolves each name and refuses it when any address it answers with is private. Sub-requests are checked too (`isLanAddressResolved` in `onBeforeRequest`), and a name that cannot be resolved is not fetched. A name that changes its answer between the check and the connection is the one case left. It is written down in the code, and the windows carry no cookies or storage. Accepted.
- **The data-folder fence** now covers the whole data folder for the file tools and the shell's best-effort check. The one exception (`allow`) is the chat's own W2-9 copy, and only when that copy is the chat's effective root. A junction inside the copy that leads elsewhere in the data folder is still refused, because the real path is protected and is not inside the allowed copy.
- **The wording** now says "best effort, not a wall", and the Auto help line is in.

## What fails: the Git LFS exception can be abused

`filterDrivers` lets a filter through when its value matches `^filter[.]lfs[.](smudge|clean|process)\s+git-lfs\s`. That only checks that the value **starts with** `git-lfs` and a space.
- Git runs filter commands through a shell. A project's own `.git/config` can give the filter the standard `git-lfs ...` words followed by a command separator and anything else. The value still matches, and the rest runs every time Bunny's git checks files out (`worktree add`) or cleans them (`add -A`). That is exactly what this check exists to stop.
- A project can also give its own hostile filter the name `lfs`, as the Chief asked. The name is not the problem. The value is.
- The test file has no Git LFS case.

**Required fix:** let through only the exact values `git lfs install` writes, compared after trimming:
- `filter.lfs.clean` is `git-lfs clean -- %f`;
- `filter.lfs.smudge` is `git-lfs smudge -- %f`;
- `filter.lfs.process` is `git-lfs filter-process`.

Any other value of a `filter.*` driver, including an `lfs` one with anything added, refuses the copy.

**Tests:** add one with the standard values (a copy is made), and one where the standard value has more text after it (refused).

Severity stays LOW to MEDIUM, as before. It needs a project that brings its own `.git` folder.

## Re-stamp at 0fdf76c: PASS (supersedes FAIL at 30d0582)

- `LFS_FILTERS` holds exactly the three values `git lfs install` writes (`git-lfs clean -- %f`, `git-lfs smudge -- %f`, `git-lfs filter-process`). Each line of `git config --local --get-regexp` must be one of those keys, lowercased, followed by exactly its value after trimming. Any other line refuses the copy.
- A value with a newline in it comes out as a second line, which matches no key, so it is refused too.
- `w29-lows` passes 4 of 4 from a copy of 0fdf76c with the variable unset. It covers separators, `$(…)`, backticks, a newline and extra text.
- c7a3d51 changes only the e2e spec.

## Re-stamp at 21c20bd: PASS (supersedes 0fdf76c)

- The filter settings are now read with `git config --local -z --get-regexp`. Each record ends with NUL; the key ends at the first newline and the value is everything after it.
- Any value that holds a CR or LF is refused. So is a key with no value. Otherwise the value must equal the exact `git lfs install` value for that key, after trimming.
- `w29-lows` passes 4 of 4 from a copy of 21c20bd with the variable unset, including a standard second line.
- LOW: a `git config` that fails for a reason other than "no such setting" is read as "no filters". `worktree add` would then fail on a broken config anyway.

## Re-review at 598ebc1: FAIL, one more setting from the project's own config

Tests from a copy of 598ebc1, with the variable unset:

| Test file | Pass | Fail |
|---|---|---|
| `w29-lows` | 5 | 0 |
| `w2-9-worktree` | 12 | 0 |
| `w29-safe-exec` | 4 | 0 |

**What holds:**
- The effective settings are read with `git config --show-scope -z --get-regexp`, so a project's `include.path`, `includeIf`, `config.worktree` and any `-c` all count. A file a project includes is reported with the `local` scope; only `global` and `system` are exempt.
- Only exit 1 means "none found". Any other failure, or a record that doesn't pair up, refuses the copy. This closes my earlier LOW.

**Trusting the global and system scopes: right.** Checking out or opening a project cannot write to `~/.gitconfig` or the system config. A tool the model runs could, but that already needs the person's permission to run commands.
- LOW edge: if the person's own global config includes a file that lives inside a project (`includeIf ... path = <a file in the project>`), that file shows as `global` and is trusted. That is the person's own choice of config.

**Still open (required, the same kind of route as the filters):** Bunny's work-in-progress commit (`finish`: `git -c user.name=Bunny -c user.email=... commit --no-verify`) honours commit signing from the project's own settings. With `commit.gpgSign=true` and `gpg.program` (or `gpg.format=ssh` with `gpg.ssh.program`) in a project's `.git/config`, or in a file it includes, that commit starts the program the project names. `--no-verify` skips hooks, not signing.
- **Fix:** add `-c commit.gpgSign=false` to Bunny's own git calls in `runGit`, next to `core.fsmonitor=false` and `core.hooksPath`. That turns signing off whatever the format.
- **Test:** a project with local `commit.gpgSign=true` and a signing program that leaves a marker file. After Finish (keep), the marker must not exist.
- Nothing else Bunny's own git calls run (`status`, `add -A`, `commit`, `worktree add/remove`, `merge --ff-only`, `branch`, `rev-parse`, `rev-list`, `config`) starts a program from config, apart from filters (closed), fsmonitor and hooks (closed) and signing (this item). `merge --ff-only` uses no merge drivers. A project with `.gitmodules` gets no copy.

## Re-stamp at 69b35e9 (with dd5967d and cd39ef0): PASS (supersedes the FAIL at 598ebc1)

- **Signing is closed.** `runGit` adds `-c commit.gpgSign=false -c tag.gpgSign=false -c rebase.gpgSign=false` next to the fsmonitor and empty-hooks settings, so a signing program named by the project (`gpg.program`, `gpg.ssh.program`) never starts. The marker-file test covers both forms, and Builder C reports it fails without the flags.
- **Includes are closed (dd5967d).** Any `include.path` or `includeIf.*.path` in the project's own settings (read with `--no-includes`, so the key is seen, not followed) refuses the copy, whether or not its condition matches here. That closes `gitdir:` and `onbranch:` conditions that would match only in the copy. Filters are also checked from the copy before Finish.
- **Exit codes (cd39ef0).** Every git failure other than exit 1 refuses the copy, in the status check and in Finish.
- **Tests,** from a copy of 69b35e9 with the variable unset: `w29-lows` 7 of 7, `w2-9-worktree` 12 of 12, `w29-safe-exec` 4 of 4.
- **Still accepted (LOW):** a file the person's own global config includes from inside a project is trusted as global. That is their own config choice.

## Re-stamp at 66b95b6: PASS (supersedes 69b35e9)

- **Signature verification is off.** A project's `merge.verifySignatures` would make Finish's merge start `gpg.program` to verify. `runGit` now also sets `merge.verifySignatures=false` and `log.showSignature=false`, and the merge passes `--no-verify-signatures`.
- **The three signing programs** (`gpg.program`, `gpg.ssh.program`, `gpg.x509.program`) point at a name that doesn't exist.
- **Tests,** from a copy of 66b95b6 with the variable unset: `w29-lows` 8 of 8, `w2-9-worktree` 12 of 12.
- **LOW:** the stand-in name `bunny-no-such-signer` is bare and predictable, so git would look it up on PATH, never in the project folder. Signing and verification are both off, so it should never be started. An absolute path that doesn't exist, under Bunny's data folder, would be cleaner.
