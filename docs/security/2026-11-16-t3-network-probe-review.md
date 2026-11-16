# T-3 offline: `GET /api/network` — Security review

Date: 2026-11-16 · Session: Security · Reviewed: `092cc6d` on `claude/builder-efa9a9` (`src/server/network.js`, the route in `src/server/app.js`, the page code in `chat.js`).
Method: code reading; their 5 unit tests (pass, run here); live checks of the guard on an invented-profile server. I did not call the probe itself live, so no request left this computer from my checks.

## Verdict: PASS (two small notes)

**Which hosts, and what they learn.** A fixed list in one file: `https://www.gstatic.com/generate_204` (Google), `https://cp.cloudflare.com/generate_204` (Cloudflare), `https://captive.apple.com/hotspot-detect.html` (Apple), asked in parallel with a 3 s limit each. Each request is a bare `GET`: no body, no cookies (Node's fetch has no cookie jar; `credentials: 'omit'` as well), no custom headers (their test asserts this), `redirect: 'manual'` so no redirect is followed. Each host sees the person's public IP address, the time, and a generic Node client with no app name or version. No chat, key, profile or identifier of the person is in the request. These are the same neutral hosts operating systems use for connectivity checks.

**When it fires.** The page asks only when the browser itself says it is offline (`networkDown` returns false at once when `navigator.onLine` is not false), so a normal send never contacts them.

**Behind the guard.** `/api/network` is an `/api/` route: it needs the launch token, a same-origin request and the right Host (the S-1 guard runs before the route). Live, on an invented profile: no token → 403 `request.noToken`; `Sec-Fetch-Site: cross-site` → 403; foreign `Origin` → 403; `PUT` without a token → 403. A foreign page therefore cannot trigger the probes.

**Cannot be made to fetch an arbitrary URL.** The route passes nothing from the request to `probeNetwork`: no query value, header or body reaches the host list (`app.js` calls `networkProbe()` with no arguments; the hosts are the constant `PROBE_ENDPOINTS`). The `endpoints` parameter exists for tests only, and any non-https or malformed entry is refused inside the function. The test-mode `PUT /api/network` only flips a flag, and only when the server runs with `BUNNY_FAKE_UPSTREAM=1`; in a normal install a `PUT` falls through to 404.

**Notes (LOW, optional):**
1. The response body is never read or cancelled (`await fetchImpl(...)` only). One host returns a short HTML page; call `res.body?.cancel()` so sockets are freed promptly.
2. The setting's help text should say plainly that the three hosts are Google, Cloudflare and Apple and what they see (the IP and the time). The code comment says the hosts are named in the help text; I did not check the text itself.
