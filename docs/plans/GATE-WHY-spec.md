# GATE-WHY: a failed gate step says why (LOW, next release)

Tech Lead spec, 2026-11-18. Asked for by the Chief of Staff. To be built by **Builder**: Tech Lead's guard limits it to `docs/**` and `*.md`. Tech Lead reviews the result.

## Problem

The gate on bf9f320 reported unit tests FAIL (1357s) with no failing test. The same code passed `npm test` on its own and passed the gate on fa152a1.

- `scripts/gate.mjs` `step()` (lines 19-35) judges `r.status` only.
- It never prints `r.signal` or `r.error`. For example, `ENOBUFS` means the output passed `maxBuffer: 64 << 20` and spawnSync killed the child.
- It never prints the `HUNG:` line from `scripts/unit-tests.mjs:49`.
- `unit-tests.mjs` `run()` never says which of its two runs ended non-zero, or how. The 1211-test run printed nothing at all.

## Change

1. **New `scripts/gate-report.mjs`.** It exports a pure function, `failureDetail(r, out)`, which returns these lines:
   - `exit status: <r.status ?? 'none'>`
   - `signal: <r.signal ?? 'none'>`
   - when there is an `r.error`: `spawn error: <code>: <message, at most 300 chars>`
   - when the code is `ENOBUFS`, one more line: the output passed maxBuffer, so the step was killed and its output is cut short
   - every output line that matches `/^\s*(HUNG|EXIT):/`, plus the 7 lines after it (the HUNG message holds the last 600 characters printed on the following lines). Each line is cut to 300 characters.

   It lives in its own file so a test can import it; `gate.mjs` runs every check when it is imported.
2. **`scripts/gate.mjs`.**
   - Import the helper.
   - In `step()`, right after the `shown` lines are printed and for **every** failed step (not only `failures: true`), print `-- why it failed --` followed by `failureDetail(r, out)`, indented 3 spaces.
3. **`scripts/unit-tests.mjs` `run()`.**
   - Inside `child.on('close')`, when `code !== 0`, print to stderr: ``\nEXIT: "${label}" ended with code ${code ?? 'none'}, signal ${signal ?? 'none'}``.
   - A run killed after a hang, or one that crashes outside a test, then names itself.
   - The resolve value stays as it is.

## Test: `test/gate-report.test.js`, using `node:test`, importing the helper directly

| Input | Expected |
|---|---|
| `{status: 1, signal: null}` with no output | `exit status: 1` and `signal: none` |
| `{status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync npm.cmd ENOBUFS'), {code: 'ENOBUFS'})}` | a `spawn error: ENOBUFS` line and the maxBuffer line |
| `{status: 1}` with output `['ok', 'HUNG: "x" printed nothing for 4 minutes. The last thing it printed:', 'tail line']` | the HUNG line and `tail line` |
| output that includes `EXIT: "all other unit tests, in parallel" ended with code 1, signal none` | that line is kept |
| `{status: 0}` | exactly the two first lines, no `spawn error` |

Optional, and slow: spawn `unit-tests.mjs` against a test file that calls `process.exit(3)` at top level, and check that stderr has `EXIT:`. The pure-function test is enough for LOW.

## Check before Tech Lead signs

- `node --test test/gate-report.test.js` passes.
- `node scripts/gate.mjs --quick` with every step green prints no `why it failed`.
- One forced failure, made temporarily and not committed (for example a step whose `ok` is always false), prints the block.
