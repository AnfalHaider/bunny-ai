# WEB-APP (v0.1.11) at ee97e26 (1e54c93 + ee97e26, from main 77f6324): Security PASS

Read in full: `src/ui/bunny-sw.js` (the new worker at /sw.js), `src/ui/sw.js` (the clearing worker at the old path), `src/server/webapp.js`, its wiring in `src/server/app.js`, and the registration in `src/ui/chat.js`. `test/webapp.test.js` passes 10 of 10 from a copy of ee97e26 with `NoDefaultCurrentDirectoryInExePath` unset. The e2e spec was not run by Security.

## The finding on the old worker (0.1.9 and 0.1.10)

The shipped `src/ui/sw.js` (scope `/src/ui/`) precached `index.html`, `settings.html`, `providers.html` and `automation.html`, and kept a copy of **every** same-origin GET outside `/api/`. Every one of those pages carries `<meta name="bunny-token">`. When the server was unreachable, it answered with the cached `index.html`.

**(5) Is the cached token a real exposure? LOW, no notice to users needed.**
- Cache Storage belongs to one origin (`http://127.0.0.1:<port>`). Only scripts of that same origin can read it, and those already get the token from `index.html`. No other site can read it.
- The token changes every launch. A cache from an earlier launch holds a token that no longer opens anything. (With "Keep the same address after restart", the cache is refreshed with each launch's token, but it is still same-origin only.)
- On disk, the cache sits in the browser's or the app's profile folder. A program running as the person could read it there, but such a program can already read far more (the DPAPI secrets themselves). It adds nothing an attacker on this PC lacks.
- LAN devices never had it: a plain-HTTP LAN address is not a secure context, so no service worker ran there, and the CSRF pages were never cached.

## (1) The new worker's cache rules keep every secret out: holds

`mayCache` in `bunny-sw.js` is the only gate, and both writing and reading the cache go through it. A response is kept only when all of these hold:
- it is a GET, from the same origin, with no query string;
- the request carries no `authorization`, `x-bunny-token` or `x-bunny-csrf` header;
- it is not under `/api/`;
- it is ok and not opaque;
- it is not HTML, except `/offline.html`;
- its path matches `^/(src/ui/<one name>.(css|js|svg|woff2?|ttf)|icons/<name>.png|manifest.webmanifest)$`, and is not `token.js`, `signin.js` or `remote.js`.

Pages (navigations) are always fetched from the network and never cached; with no network they get `/offline.html`. The launch token and the CSRF token reach a page only through the `<head>` injection of HTML pages, and no HTML except the offline page is ever kept. The offline page is served by `webapp.js` without injection, and the copy of it under `/src/ui/offline.html` (which the static handler does inject into) is HTML at another path, so it is not kept.

LOW, about the wording: the `set-cookie` check can never fire, because a page's own scripts (a service worker included) are never shown that header. The path rule is what keeps cookie-setting answers (the sign-in) out. Drop the claim or leave it as a harmless extra.

## (2) The clearing worker: clears the current origin; earlier origins in Bunny's window stay

The clearing worker at `/src/ui/sw.js` takes over at once, deletes every cache on its origin, unregisters itself and reloads its open pages. `chat.js` also unregisters any `/src/ui/` registration and registers the new worker at `/`.

Not every case is covered:
- **The browser fetches the clearing worker only from the origin Bunny is on now.** Bunny picks a new port at each launch unless "Keep the same address after restart" is on, so registrations and caches from earlier launches, at other ports, are never visited again. Their tokens are dead, so this is hygiene, not exposure.
- **Inside Bunny's own window, `chat.js` skips the unregister** (`!window.bunnyDesktop`), and the old worker was registered there too in 0.1.9 and 0.1.10.

**Recommended (LOW), not blocking:** once, on the first start of 0.1.11, have the main process run `session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })`. That clears every old registration and cache in Bunny's window, whatever the port. The person's own browser can only be cleared from the origin that browser visits, so the clearing worker there is the best available.

## (3) The token-free paths can't be widened: holds

- `isWebappPath` is `Object.hasOwn` over a frozen map of exact paths (the manifest, `/sw.js`, `/offline.html` and 5 icons). `webappResponse` checks again and reads only the mapped file under `src/ui`. Prefix, `..`, case and prototype tricks find no entry.
- The branch (`app.js:3372`) comes after the request guard (`app.js:565`), so the exact Host, Origin and Sec-Fetch-Site rules apply on 127.0.0.1, and the LAN server's own checks apply first for devices.
- The worker is served with `Service-Worker-Allowed: /` only on `/sw.js`. Its version marker is cleaned (`[^\w.-]` removed). The offline page carries a strict CSP (`default-src 'none'`, `script-src 'self'`, `frame-ancestors 'none'`).

## (4) The LAN surface before sign-in: holds

A device that has not signed in may now fetch only the manifest and the five icons (`WEBAPP_PUBLIC_PATHS`), next to the sign-in page and its script. None of them holds a secret. Not `/sw.js` and not `/offline.html`. The sign-in CSP gains only `img-src 'self'` and `manifest-src 'self'`.

## Registration

The worker is registered only when `window.isSecureContext`, not on `file:` and not inside Bunny's window. On a LAN device (plain HTTP) no worker runs at all. Its scope `/` covers `/api/`, but the worker returns early there and leaves those requests to the server, including the artifact pages under `/api/artifacts/`.
