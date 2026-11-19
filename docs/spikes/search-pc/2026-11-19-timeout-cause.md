# SEARCH-PC: why "a word in no file" timed out at 10 s (Builder B, 2026-11-19)

QA's real test on b5c3c72: three read-only searches for words in no file each hit the full 10 s limit (10,087, 10,038 and 10,039 ms), with WSearch running.

## Cause

**The query shape, not PowerShell, the connection or a first-call cost.** Each term was `(CONTAINS('"term"') OR System.ItemName LIKE '%term%')`. A LIKE with a leading `%` cannot use the
full-text index, so for a word found in no file Windows Search read the whole index. For a common word the TOP limit stops it early, which is why the earlier gibberish search once looked fine.

## Timings (this PC, read-only; PowerShell start, connection open, query; one process each; 16 cores, idle when measured)

| What | Time |
|---|---|
| PowerShell start, `-NoProfile`, nothing else | 0.20 - 0.28 s |
| Service check + `new OleDbConnection` | 0.04 + 0.05 s |
| `Open()` of Search.CollatorDSO | about 0.02 s (115 ms from the start of the script) |
| Query `CONTAINS` only, word in no file | whole script 0.42 - 0.45 s (execute 0.2 s) |
| **Shipped query (CONTAINS OR name LIKE '%word%'), word in no file** | **over 30 s, three times (killed by the 40 s guard)** |
| `System.ItemName LIKE '%word%'` alone, word in no file | over 18 s, twice (killed) |
| `CONTAINS(System.ItemName, '"word*"')` alone | 0.46 s |
| `CONTAINS OR CONTAINS(System.ItemName, '"word*"')`, word in no file | 0.45 s |
| The same with a common word ("windows") | 0.51 s; the LIKE form: 3.7 - 4.5 s |

So the start (0.2 s), the connection (0.1 s) and the first call are all small. Only the LIKE scan is slow, and it grows with the index.

## Fix

The name part of a term is now `CONTAINS(System.ItemName, '"term*"')`: a prefix match on the words of the file name, which uses the index.

- **After, with the shipped builder and runner, three runs each:** a word in no file 0.44 - 0.62 s; two such words 0.50 - 0.62 s; a common word 0.57 - 0.68 s; a phrase 1.0 - 1.1 s;
  `a_b.c` 3.3 s (it matches 50 rows); kind + date filter 0.48 - 0.60 s.
- **The price, said plainly:** a file name is matched from the start of a word ("rep" finds "Report 2024"), not from the middle ("port" does not). Words inside the file's text are still found by `CONTAINS`.
- `$m.CommandTimeout = 8` is set, so the provider ends its own query a little before Bunny's 10 s limit. The 10 s limit stays.
- A persistent PowerShell worker was not needed: start-up is 0.2 s.
