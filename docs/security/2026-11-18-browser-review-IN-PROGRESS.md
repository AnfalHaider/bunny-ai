# BROWSER (516aa43, f741c89): Security review, IN PROGRESS, not signed

Stopped at the usage limit. **No sign-off has been given for either step.**

## Read so far

**Step 1, 516aa43: looks sound; the probe is still to run.**
- The shell opens only `browserAddress(origin)`, which is `http://127.0.0.1:<port>/`, with no path, query or token, and nothing taken from the page.
- The server listens on 127.0.0.1 only. A fixed port is stored, with a fallback when it is taken.
- LOW: a fixed port makes Bunny easier for other local pages to find. That is acceptable, because the S-1 token, Host and Origin checks are unchanged.

**Step 2, f741c89: what holds, by code reading.**

Binding and switching on:
- The second server listens on `findLanAddress()`: a private IPv4 address (10/8, 172.16/12, 192.168/16) that is not internal. Never 0.0.0.0, never a public address.
- It is off after every restart, because `on` is never read back from a file.

Checks on every request:
- The Host must be exactly `lan:port`.
- The Origin, when sent, must be exactly that origin.
- Sec-Fetch-Site must be `same-origin` or `none`.
- route() and remoteRoute parse the path the same way: `new URL` then `decodeURIComponent` (`app.js:538` and `:3371`).
- The only non-/api route found so far is `/` (`app.js:3266`).

Before signing in:
- A device gets only `signin.html` and `signin.js`, under a strict CSP. It gets no token and no API.
- The sign-in body is limited to 4 KB.

The cookie, CSRF and window-only:
- The cookie is a 32-byte random value, HttpOnly and SameSite=Strict, with a 12-hour idle timeout.
- Every write needs the session's `x-bunny-csrf` header.
- `windowOnly()` refuses any request with `req.bunnyRemote`, and remoteRoute also checks `isWindowOnlyRoute`.
- `remoteBody` keeps only the text, up to 8 attachments, the provider and model, and retry, and forces Chat mode and `textOnly`.

The passcode:
- It is stored as salted scrypt (N=16384, r=8, p=1).
- After 5 wrong tries, a device waits 30 s, then twice as long each time, up to 15 minutes.
- After more than 30 failures in 10 minutes from anyone, every device waits 60 s.

## Still to check before signing

1. Read what `GET /api/settings`, `/api/providers`, `/api/memory` and `/api/skills` return, to confirm no secret, key or token is included. On the Chief's question about how wide the read list is, my leaning: drop `/api/memory` and `/api/skills` unless the remote page needs them.
2. Check that `normaliseAttachments` takes no `path` or local-file field from a remote message.
3. Plain HTTP on a LAN: the passcode and the cookie travel unencrypted. The window's warning must say this plainly (shared or public Wi-Fi), as well as the "Private networks only" firewall advice. This is for the owner to see.
4. The same-site rule treats another port on the same LAN IP as the same site, so the cookie is sent from such a page. The CSRF header covers writes; confirm no GET on the allow-list changes anything.
5. Re-run `test/remote-access.test.js` and `test/probes/remote-access-smoke.cjs` one at a time. Note that our shells set `NoDefaultCurrentDirectoryInExePath`, as the W2-9 review found.
6. LOW notes so far:
   - the first private adapter may be a VPN, Hyper-V or WSL adapter rather than the Wi-Fi;
   - the flood stop lets anyone on the LAN lock everyone out for 60 s at a time;
   - the second server has only Node's default timeouts.
