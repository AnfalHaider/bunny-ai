# TEST-DNS: unit tests never wait on the real network (LOW, next release)

Tech Lead spec, 2026-11-18. Asked for by the Chief of Staff. To be built by **Builder**; Tech Lead reviews.

## The problem

The v0.1.13 gate on 371b4b4 hung in "all other unit tests, in parallel". Nothing printed for 4 minutes and no test failed, so the watchdog (`scripts/unit-tests.mjs:47-50`) killed the run.

At the time, this PC's resolver took about 12 s to fail a lookup; the Chief of Staff measured 12.2 s. The unit tests use many host names that are invented or meant to be blocked:
- in the test files: 54 × `example.com`, 39 × `github.com`, 20 × `x.test`, 18 × `example.test`, 11 × `evil.example`, 10 × `weather.example.com`, and `api.openai.com`, `registry.npmjs.org`, `*.invalid`, `192.168.1.1.nip.io` and more (a `git grep` of `test/` at 371b4b4);
- in the code under test, which reaches the network in three ways:
  1. **`dns/promises` `lookup` called directly:** `src/server/download.js:8` (`fetchLimited`, where `lookupImpl` can be injected), `src/server/mcpOAuth.js:17` (`lookupImpl` can be injected), and `electron/browserViews.js:19` (`resolveName` can be injected).
  2. **`fetch()` with no fetch injected.** Every `fetchImpl = globalThis.fetch` default (`connections.js`, `discovery.js`, `oauth.js`, `accounts.js`, `appTools.js`, `chat.js`, `github.js`, `google.js`, `mcp.js`, `mcpOAuth.js`, `network.js`, `pluginImport.js`, `toolInstall.js`, `updates.js`). undici resolves the host through `dns.lookup` before it connects.
  3. **Sockets opened to an address that is not this PC.** A test that never meant to leave the PC can still wait for a connect timeout. For example, a private IP or a `nip.io` name that resolves to one.

Each of these costs as long as the resolver or network takes to answer: 12 s per lookup today, more on a worse network. Dozens of files running in parallel, several lookups each, a slow resolver: together they can print nothing for 4 minutes. **So the unit suite depends on the PC's network. The gate must not.**

A second problem: when HUNG fires, it prints the last 600 characters of output. That shows which tests had finished, not which file is stuck.

## The fix, in three parts

### 1. A test preload that blocks the network (`test/support/no-network.mjs`)

It loads before any test file, in every unit-test process. `scripts/unit-tests.mjs` passes `--import ./test/support/no-network.mjs` to both runs. It is also set in `NODE_OPTIONS` for both runs, so a child `node` that a test spawns gets it too.

At load time it does four things:

1. **DNS.** It replaces `dns.lookup` and `dns.promises.lookup`. These are what `net`, `tls` and undici call; `resolve*` gets the same treatment. The new versions answer **at once**:
   - **Resolves:**
     - `localhost` and `*.localhost`: `127.0.0.1` / `::1`;
     - an IP literal: itself, as Node does;
     - a name the test has registered with `allowHost(name, address)` (see 4): that address.
   - **Everything else:** `ENOTFOUND`, with `code`, `errno`, `syscall` and `hostname` set exactly as Node's own error is. `.invalid`, `.test`, `.example`, `example.com`, `github.com` and `api.openai.com` all fail the same way: in under a millisecond, and the same on every PC.

   This matches what a lookup of a reserved name returns on a healthy network, so tests that expect "not found" keep passing. They just stop waiting.

2. **Sockets.** It wraps `net.Socket.prototype.connect` (which `tls` and undici also use). A connect to an address that is not loopback (127.0.0.0/8, `::1`, or a registered address) fails **at once**: the socket gets an `ECONNREFUSED` error on the next tick, set as Node sets it.
   - It also writes one line to stderr: `NO-NETWORK: <test file> tried to reach <address>:<port>`. The test file is taken from `process.argv` or the test's `file` (see 3).
   - The connect itself is never made.
   - So a test that leaves the PC by mistake is named instead of being slow.

3. **Opt-out, for a person only.** With `BUNNY_TEST_NETWORK=1` the preload does nothing, so a developer can run one file against the real network on purpose. `scripts/unit-tests.mjs` **refuses to start** when that variable is set, so the gate can never run with the network on.

4. **A small helper for tests:** `test/support/net.mjs` exports `allowHost(name, address)` and `resetHosts()`. The few tests that need a name to resolve register it, pointed at a local test server on 127.0.0.1. Examples are the "rebind" and "pinned" tests in `mcp-oauth-private.test.js` and `download-file.test.js`. Those tests mostly inject `lookupImpl` already, and that stays the preferred way.

**What does not change:**
- `src/` and `electron/`. No production code changes: the injectable `lookupImpl`, `resolveName` and `fetchImpl` hooks already exist.
- The e2e suite. Playwright and its server use the fake upstream and the invented profile, and need real loopback only. Checking e2e is a follow-up (below).

**Assumption to confirm in the build (A1):** on the Node in use (v26.12.1 here), undici's `fetch` connects through `net.connect` / `tls.connect` with the default `dns.lookup`, read when it is called. If it captures `dns.lookup` when it loads, the preload must load first (it does, through `--import`) or pass undici a `connect.lookup`. The test in §3 proves which, either way.

### 2. HUNG names the stuck file (`scripts/unit-tests.mjs`)

The runner adds a second reporter beside the spec output that both the person and GATE-NAMES read:

```
--test-reporter=spec --test-reporter-destination=stdout
--test-reporter=./scripts/test-progress.mjs --test-reporter-destination=<temp file in os.tmpdir()>
```

`scripts/test-progress.mjs` is a reporter (an async generator over test events). For `test:start`, `test:pass` and `test:fail` it writes one line `{e, file, name, nesting, t}`, and nothing else. No test output and no values go in the file.

When the watchdog fires, the runner reads that file before it kills the child and prints:

```
HUNG: "<label>" printed nothing for 4 minutes.
  Still running (started, never finished):
    test/<file>.test.js  ›  <test name>  (started 03:58 ago)
    ...
  Files that never started: <n>
  The last thing it printed:
  <the 600 characters, as today>
```

When the child ends, the temp file is removed.

**Fit with GATE-WHY (5c32755, reviewed, not yet on the release line):**
- GATE-WHY adds the `EXIT:` line when a run ends non-zero.
- `failureDetail` in `scripts/gate-report.mjs` keeps a `HUNG:` line and the 7 lines after it. **Raise that to 20 lines**, so the "Still running" list reaches the gate's report.
- If GATE-WHY lands first, this change edits its `failureDetail`. If this lands first, GATE-WHY rebases onto it.

### 3. Tests

**`test/no-network.test.js`, run in the normal parallel set:**
- `dns.promises.lookup('github.com')` rejects with `ENOTFOUND` in under 50 ms. So do `nowhere.invalid` and `x.test`.
- `localhost` resolves to loopback.
- `fetch('https://api.openai.com/')` rejects in under 200 ms, and its cause has code `ENOTFOUND`.
- `net.connect(443, '8.8.8.8')` errors with `ECONNREFUSED` in under 50 ms and writes the `NO-NETWORK:` line.
- `allowHost('rebind.example', '127.0.0.1')` lets a fetch reach a local server; after `resetHosts()` it fails again.
- A child `node -e` (as a test would spawn one) also gets `ENOTFOUND` fast, which proves `NODE_OPTIONS`.
- `BUNNY_TEST_NETWORK=1` makes `scripts/unit-tests.mjs --list` exit non-zero with a plain message.

This file fails if part 1 is missing, so the gate checks itself.

**`test/test-progress.test.js`:** it runs `node --test` on a fixture folder that holds one file that never ends and one that passes, with `SILENT_MS` set low through an env override that only the tests use. It checks that the HUNG text names the never-ending file and its test, and that the temp file is gone afterwards.

**The whole suite, normally and with a slow resolver.** Before review, the build runs `node scripts/unit-tests.mjs`:
1. once as it is;
2. once with the in-test slow-resolver stand-in loaded before the preload. That is `test/support/slow-resolver.mjs`, with `BUNNY_SLOW_DNS_MS`, 12 s by default.

**Corrected 2026-11-19 (the Chief of Staff):** no Wi-Fi switched off, and no system or network setting changed on the owner's PC. The stand-in replaces both of the original runs.

Both runs must pass, and their total time must be within about 10% of a normal run. Paste both outputs (O1). Any `NO-NETWORK:` line in those runs is a test to fix (inject a `fetchImpl` / `lookupImpl`, or use `allowHost`), not a line to silence.

## Gate changes

None to `scripts/gate.mjs` itself. The unit step now runs without the network by construction, and `no-network.test.js` fails if it ever doesn't. GATE-WHY's line limit goes up (part 2).

## Follow-ups (not this row)

- **E2E-DNS:** check whether any Playwright test or the e2e server reaches a real host. If so, the same preload goes through the e2e server's `NODE_OPTIONS`.
- **The RUN-1 tree kill:** on Windows, `child.kill('SIGKILL')` in the watchdog may leave grandchildren (spawned test servers) running. That is the existing RUN-1 row; it is not changed here.

## Risk

LOW. It touches the test harness only: `test/support/*`, `scripts/unit-tests.mjs` and a new reporter, with no app code. The one way it could hide something is a test that **should** reach the network and now sees `ENOTFOUND`. The rule is that no unit test should, and the opt-out exists for a person to check one on purpose.
