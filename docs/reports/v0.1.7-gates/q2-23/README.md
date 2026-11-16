# Q2-23: the stale-token tests (v0.1.7 candidate fix bf83b01)

Written by Builder (A), 2026-11-16. Branch of the fix: `claude/release-0.1.7-q2-23` at `bf83b01` (this folder is docs only and is not part of that sha).

## What failed

On a quiet machine the first of the Chief of Staff's three gates on the candidate 909a439 failed two end-to-end tests in `e2e/request-guard.spec.js`:
"a stale token (the server restarted) is refreshed and the call retried" and "when the token cannot be refreshed the window says Bunny restarted".

## Two causes

1. **A real bug in `src/ui/token.js`.** A call that left the page with the stale token, and whose 403 `request.noToken` arrived after another call had already fetched the new token, asked for a refresh, was told the page token was already current ("same"), and was handed the 403 without a retry. A person would see this after a server restart with several calls in flight at start-up. Fix: the call remembers the token it sent; if the page token changed by the time its 403 arrives, it is sent again with the new one.
2. **Two races in the tests themselves.**
   - The page's own start-up calls could refresh the token between the test setting the stale one and the test's own fetch (200 where 403 was expected).
   - The app registers a service worker. Once it is active it answers fetches, and `page.route()` no longer sees them, so the forced "refresh fails" never happened.
   Fix: the tests wait for the page to go quiet, install the route before setting the stale token, use `cache: 'no-store'`, and the spec blocks service workers.

## Evidence

All with `--workers=1`, a fresh server and data folder per run (Playwright starts them).

| What | Result | File |
|---|---|---|
| Candidate code, whole spec file, `--repeat-each=15` | 89 passed, 1 failed (the "cannot be refreshed" test: expected 403, received 200) | `repeat-before-15x.txt` |
| New test "a stale-token 403 that arrives after another call refreshed is sent again", on the OLD `token.js` | fails (403) | run on its own, not saved |
| Same new test with the fix | passes | run on its own, not saved |
| An intermediate attempt (waiting for the page to go quiet only) | 30 of 30 failed the "cannot be refreshed" test: the service worker answered the fetch | not saved |
| Fixed code, whole spec file (7 tests), `--repeat-each=30` | **210 of 210 passed** (2.3 min) | `repeat-after-30x.txt` |
| `node scripts/gate.mjs` at `bf83b01` | **PASS 8/8**: conflict markers, request guard stays on, unit 130 s, e2e 274 s, memory check, audit, secret scan (379 tracked files), git hooks wired | `gate-bf83b01.txt` |
