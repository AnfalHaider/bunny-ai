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
