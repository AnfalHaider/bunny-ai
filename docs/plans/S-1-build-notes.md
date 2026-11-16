---
title: S-1 build notes — lock the local API to Bunny's own pages
author: tech-lead
date: 2026-11-16
risk: HIGH (security control)
owner_go: "Go: fix S-1 first (Recommended)" — relayed under AGENTS.md 7E, 2026-11-16 (AGENTS.md, "S-1 go")
source: docs/security/2026-11-16-baseline-0.1.4.md on claude/security-3c782b (297b20a), finding S-1
code_read_at: 06b06b4 (0.1.4)
for: Builder (writes the change), QA and Security (sign off), Tech Lead (reviews the diff)
---

# S-1 build notes

## What is being fixed, in one paragraph

Any web page open in any browser on this PC can send requests to Bunny's local server (`127.0.0.1:<random port>`), because `route()` (`src/server/app.js:433`) checks nothing about who is asking. The server answers by path and method, and `readBody` (`:108`) parses JSON whatever the `Content-Type` is, so a cross-site `text/plain` POST needs no preflight. One of the reachable actions adds a local program (`POST /api/mcp` with `confirmLocal:true`). DNS rebinding would make the answers readable too. The fix is three independent checks in one function, run first on every request: **Host**, **Origin / Sec-Fetch-Site**, **per-launch token**.

## Decisions (with the reason, so a reviewer can disagree)

| # | Decision | Why |
|---|---|---|
| D1 | One new function `checkRequest(req, res, ctx)` in a new file `src/server/requestGuard.js`; `route()` calls it as its first statement. The refusal is `403` JSON `{code, message}`. | One place to read, one place to test. A function that returns a verdict (`{ok}` or `{ok:false, code}`) is unit-testable without a socket. |
| D2 | The token is made **inside `createApp`** (`crypto.randomBytes(32).toString('hex')`) and exposed as `app.apiToken` on the returned object. Electron's `main.js` and `src/server/main.js` need no change to make or pass it. | Smallest change; no IPC, no preload change, the same code path in the desktop window and in plain-browser dev mode. |
| D3 | The page gets the token from the server: when `GET /src/ui/*.html` is served, the server inserts `<meta name="bunny-token" content="…">` and `<script src="/src/ui/token.js"></script>` right after `<head>`. The new static file `src/ui/token.js` wraps `window.fetch` so that every same-origin `/api/` request carries `X-Bunny-Token`. | All five pages (`index`, `providers`, `settings`, `automation`, `customize`: each has a literal `<head>`) and every raw `fetch(` call in them (`customize.html:366`, `automation.html:269`, …) are covered with no edit to any call site. A classic script in `<head>` runs before the pages' module scripts. |
| D4 | Fetch-based streaming (SSE) needs nothing special: the chat stream is `fetch` POST (`src/ui/api.js:33`), not `EventSource` (`grep EventSource` finds none), so the header goes with it. | Confirmed in code. |
| D5 | **Header-less loads** are an explicit allow-list of four `GET` routes: `/api/health`, `/api/profile/photo`, `/api/screens/<uuid>.png`, `/api/artifacts/<uuid>/raw`. They skip the token only. They still pass the Host check and `Sec-Fetch-Site` rule, and image responses add `Cross-Origin-Resource-Policy: same-origin` and `X-Content-Type-Options: nosniff`. | A browser cannot put a header on an `<img src>` (`chat.js:2818`, `settings.html:660`, `chat.js:1098` for screens) or on `window.open(.../raw)` (`chat.js:2379`). Fetching each as a blob would mean editing the UI at several sites for little gain: a cross-site page cannot read these answers (no CORS), and CORP closes the embed. `/raw` already serves with `Content-Security-Policy: sandbox …` (`app.js:746`). `/api/health` is the Playwright readiness probe (`playwright.config.js`). |
| D6 | Tests that call the API without a browser use an option, `createApp({ localGuard: false })`, set once in `test/helpers.js` `startApp`. Production code never sets it. A new `test/request-guard.test.js` and a new e2e spec run with the guard **on**. | 62 direct `fetch(` calls in `test/` would otherwise all need a header. The real path stays covered by the new tests and by the e2e suite. The gate gets a one-line check that `localGuard` appears only under `test/`. |
| D7 | `BUNNY_API_TOKEN` (a fixed token) is honoured **only when `BUNNY_FAKE_UPSTREAM=1`**, read in `src/server/main.js` and passed as `createApp({ apiToken })`. In normal runs the token exists only in memory. It is never put in `process.env` of the server, and never passed to the commands, hooks and custom tools that inherit `process.env` (`app.js:284`, `customTools.js:98`). | The e2e run needs a known token for its `request` fixture. Test mode already means "invented profile". |

## Request rules, in order (the whole specification)

For every request, with `P = req.socket.localPort`:

1. **Host.** `req.headers.host` must be exactly `127.0.0.1:P` or `localhost:P` (case-insensitive). Missing or anything else → `403 request.badHost`. (Stops DNS rebinding: a rebound page sends its own name.) `[::1]` is not allowed: the server binds IPv4 only.
2. **Sec-Fetch-Site**, when the header is present: `/api/*` except D5 routes → must be `same-origin`. Everything else (static files, D5 routes) → `same-origin` or `none`. Otherwise `403 request.badOrigin`. (`none` is a typed address or the Electron `loadURL`; `same-site` covers a page on another port of 127.0.0.1.)
3. **Origin**, when the header is present, on any method: must equal `http://` + the validated Host header. Otherwise (including the literal `null`, which a sandboxed artifact frame sends) → `403 request.badOrigin`.
4. **Token**, for `/api/*` except D5 routes: `X-Bunny-Token` must equal the launch token (`crypto.timingSafeEqual` on equal-length buffers). Otherwise `403 request.noToken`. A request with neither Origin nor Sec-Fetch-Site (a non-browser client) is allowed by rules 2–3 and relies on this rule alone.
5. Static files (`/`, `/src/ui/*`) need rules 1–2 only; the token is *given* by them (D3). HTML responses add `Cache-Control: no-store` so a stale token is never reused in plain-browser mode, plus `Content-Security-Policy: frame-ancestors 'self'` (optional hardening; the Electron frame-stripping handler at `main.js:32` only touches sub-frames, so the desktop window is unaffected).

The message text must tell the person what to do, in the existing voice: `request.noToken` → "This window is out of date. Close it and open Bunny AI again (or reload the page)." The other two codes use a neutral "That request did not come from Bunny AI." Never put the expected host, origin or token in a message or a log.

## Change list for Builder (files and the reason)

| File | Change |
|---|---|
| `src/server/requestGuard.js` (new) | `createRequestGuard({ token })` → `{ check(req, path, method), token }`. Pure: reads headers only. Holds the D5 allow-list and the rules above. |
| `src/server/app.js` `createApp` (`:155`) | New options `apiToken`, `localGuard = true`. Create the guard with `apiToken ?? randomBytes(32).toString('hex')`. Return `apiToken` in the object (`:2516`). |
| `src/server/app.js` `route()` (`:433`) | First statement after `path`/`method` are known: run the guard unless `localGuard === false`; on refusal `sendJson(res, 403, …)` and return. |
| `src/server/app.js` static branch (`:2473-2495`) | For `.html` files only: insert the meta + script tag after the first `<head>` and add the no-store header. Other static files unchanged. |
| `src/server/app.js` `:370` (scheduled runs) | The server calls its own API over HTTP (`fetch(http://127.0.0.1:${port}/api/sessions/…/messages)`). Add `'x-bunny-token': token` to that request, or scheduled tasks will fail with 403. Easy to miss; QA should schedule a run in a test (see T-12). |
| `src/server/app.js` `:585-611`, `:1173`, `:735` | Add `Cross-Origin-Resource-Policy: same-origin` and `X-Content-Type-Options: nosniff` to the photo and screenshot `GET` responses (also closes the two hardening notes in S-9). |
| `src/ui/token.js` (new, static) | Read the meta; replace `window.fetch` with a wrapper that adds the header when the resolved URL is same-origin and the path starts with `/api/`; handle `fetch(Request)` and `fetch(string)`; leave other requests alone. About 15 lines. No export; a classic script. |
| `src/server/main.js` | When `BUNNY_FAKE_UPSTREAM=1` and `BUNNY_API_TOKEN` is set, pass it as `apiToken` (D7). Nothing else. |
| `test/helpers.js` `startApp` | Add `localGuard: false` (D6). |
| `e2e/setup.js`, `playwright.config.js` | Export a constant `E2E_TOKEN`; the server `env` gets `BUNNY_API_TOKEN: E2E_TOKEN`; `use.extraHTTPHeaders` gets `x-bunny-token`. (Playwright applies these to the `request` fixture and to pages.) |
| `src/ui/sw.js` | No change needed. It lets `/api/` pass through, and it fetches the HTML network-first, so a stale token is served only when the server is unreachable. Verify with T-14 that `fetch(event.request)` from the worker is still `same-origin`. |
| `.claude/launch.json` | **No change.** The preview runs `node src/server/main.js` with `BUNNY_FAKE_UPSTREAM=1`; the browser pane loads the page and gets its token by injection. (A random token per start is fine; `BUNNY_API_TOKEN` is optional there.) |
| `docs/help/*` or in-app help | The only person-visible change is the `request.noToken` message. If a help page lists error messages, add the line there (O7). Otherwise "no help change" goes in the sign-off. |

Not changed: `electron/main.js`, `electron/preload.cjs` (D2). The IPC handlers keep their own sender check (`main.js` `isOwn`).

## Test cases

Write them first (red), then the code (green). Unit-level tests go in `test/request-guard.test.js`, calling the guard function with plain objects; route-level ones start the app through a copy of `startApp` that leaves `localGuard` on and pass `apiToken: 'unit-test-token'`. Browser-level ones go in `e2e/request-guard.spec.js` with `test.use({ extraHTTPHeaders: {} })` so the real injection is exercised.

| # | Case | Request | Expected |
|---|---|---|---|
| T-1 | **Allowed**: normal call | `GET /api/settings`, Host `127.0.0.1:P`, `X-Bunny-Token` right, no Origin | 200 |
| T-2 | Allowed: page-style call | `PUT /api/settings`, Host `localhost:P`, Origin `http://localhost:P`, `Sec-Fetch-Site: same-origin`, right token | 200 |
| T-3 | Allowed: static page | `GET /src/ui/index.html`, `Sec-Fetch-Site: none`, no token | 200; body contains the meta and `token.js` script tag; `Cache-Control: no-store`; token in the meta equals `app.apiToken` |
| T-4 | Allowed: header-less loads | `GET /api/profile/photo`, `/api/screens/<uuid>.png`, `/api/artifacts/<uuid>/raw`, `/api/health`, `Sec-Fetch-Site: same-origin`, no token | not 403 (404 for a missing item is fine); image responses carry the CORP and nosniff headers |
| T-5 | **Cross-origin denied** | `POST /api/mcp` `{command:"calc", confirmLocal:true}`, Host ok, Origin `http://evil.example`, right token | 403 `request.badOrigin`; **no connector is stored** (assert `GET /api/mcp` is empty afterwards) |
| T-6 | Cross-site fetch metadata | same call with `Sec-Fetch-Site: cross-site`, then `same-site` (a page on `127.0.0.1:9999`), no Origin | 403 `request.badOrigin` for each |
| T-7 | Origin `null` (sandboxed artifact frame) | `PUT /api/settings`, Origin `null`, right token | 403 `request.badOrigin` |
| T-8 | Origin on a different port of the same host | Origin `http://127.0.0.1:9999`, Host `127.0.0.1:P` | 403 `request.badOrigin` |
| T-9 | **Missing token** | `POST /api/mcp` as T-5 but no Origin, no token | 403 `request.noToken`; nothing stored |
| T-10 | Wrong token | same with a token of the right length but wrong; and with a short one | 403 `request.noToken` (no exception from the comparison) |
| T-11 | **DNS-rebinding Host** | `GET /api/sessions`, Host `attacker.example:P`, right token; also Host `attacker.example`, Host missing, Host `127.0.0.1` (no port), Host `127.0.0.1:P+1`, Host `[::1]:P`, Host `localhost.evil.example:P` | 403 `request.badHost` each; the response body does not contain the real port or token |
| T-12 | Scheduled run still works | with the guard on and `fake:false`, run a due schedule that has a folder (the `:370` self-call) | the run completes (not 403). If it cannot be driven in a unit test, QA walks it once in the invented profile |
| T-13 | Preflight | `OPTIONS /api/settings`, Origin foreign, `Access-Control-Request-Method: PUT` | 403; no `Access-Control-Allow-*` header in any response |
| T-14 | Browser, real path (e2e) | page loads `index.html` with no extra header; `page.evaluate(() => fetch('/api/settings').then(r => r.status))` | 200. Repeat with the service worker active (reload once after it registers) |
| T-15 | Browser, cross-origin (e2e) | a second tiny server on another port serves a page that runs `fetch('http://127.0.0.1:P/api/mcp', {method:'POST', mode:'no-cors', body:'{"command":"calc","confirmLocal":true}'})`; the test opens it | the request is refused or has no effect: `GET /api/mcp` is empty afterwards |
| T-16 | Browser, the sandboxed artifact frame | open an HTML artifact whose script calls `fetch(location.origin + '/api/settings')` | refused (Origin `null`); the artifact still renders |
| T-17 | Chat streaming | send a message and read the stream through the UI | stream completes (proves D4 with the wrapper) |
| T-18 | Existing suites | `npm test`, then `npm run test:e2e` (all 62 browser tests), then `node scripts/gate.mjs` | all green; paste the output (O1, O2) |
| T-19 | Malformed | header values with a trailing space, mixed case (`LOCALHOST:P`), two `Origin` headers, a 10 KB `Origin`, a token with non-ASCII bytes, a request with no `Host` at all (HTTP/1.0) | each gives a 403 from the guard or a clean pass for the mixed-case-Host case; the process never throws |

## Risks and false blocks (QA: walk these by hand in the invented profile, Electron and plain browser)

- **Anything between the browser and the server changes Host.** A reverse proxy, a tunnel, or a cloud preview that rewrites Host is blocked by design. The local preview pane (`localhost:5288`) and Electron (`127.0.0.1:<port>`) are both allowed.
- **The pop-out chat window** (`main.js` `setWindowOpenHandler`) loads an HTML page, so it receives the same launch token. Walk it.
- **The browser pane** shows other sites (including `localhost:<dev port>` pages Bunny's agent runs) inside iframes of Bunny's page. Their calls to Bunny's API now fail on Origin: intended. Bunny's own calls from the parent page are unaffected.
- **Service worker + `fetch(event.request)`**: expect `Sec-Fetch-Site: same-origin`, but verify in T-14, because a wrong value would block every asset in the installed app.
- **Stale page after a restart in plain-browser mode** (fixed port): the old tab keeps its old token until reloaded; every call returns `request.noToken` with the message above. That is the intended failure and it must be readable, not a blank screen.
- **`localGuard: false` leaking into production** is the one way this fix silently turns off. The gate check in D6 and a unit test asserting `createApp({ dataDir })` returns a guard that refuses a tokenless call cover it.
- **The token does not defend against other programs the owner runs** (they can read the page, or the process). That is S-3's territory (the agent's command tools run as the same user). Say so in the sign-off rather than imply more.

## Not in this go (separate board rows; the owner's option named only Host, Origin and the token)

- S-1.4: make the local-connector confirmation (`confirmLocal`, `app.js:806`) a real prompt owned by the main process. Still valuable: after this fix, any code running in Bunny's own page can set that flag.
- S-1.5: require `Content-Type: application/json` on JSON routes.
- S-4: the 300 MB import cap, which this fix puts behind the token but does not shrink.
- A fixed-per-install token or a per-window token: not needed; one token per launch is the owner's choice.

## Sign-offs and order

O10: `docs/signoffs/s-1/` needs `qa.md`, `tech-lead.md`, `librarian.md`, `chief-of-staff.md` plus `security.md` as the owner asked (add `_required.md` listing all five). Tech Lead reviews Builder's diff against this document, the tests against the table above, and the gate output. Release is a separate word from the owner: "release 0.1.5" (7E), by Release Ops.

Evidence to paste before sign-off (O1): `npm test` and `npm run test:e2e` results with counts, `node scripts/gate.mjs` output, the T-5, T-9 and T-11 results before the fix (red) and after it (green), and a screenshot of the `request.noToken` message from an invented profile if the wording is shown in the UI.
