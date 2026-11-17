---
piece: sb-2
role: security
sha: dbbf1dc
verdict: PASS
date: 2026-11-17
---

# SB-1 (3e8f598) and SB-2 (dbbf1dc): Security review

Branch `claude/builder-a-v0110`, on main d183f9c with settings-bridge merged in 5b0d846.

All probes ran in real Electron 45.3.2 with an invented userData folder and a stand-in server. They used no Bunny profile. The branch's `electron/preload.cjs`, `electron/own-pages.js` and `test/probes/artifact-window-smoke.cjs` were copied unchanged into `docs/security/sb1-probe/` to run.

## SB-1 at 3e8f598: PASS, with one defect for the Builder (SB1-a)

### (4) The Builder's probe, re-run

`artifact-window-smoke.cjs` gives `PROBE PASSED: 9 of 9`.

### (1) Does the allow-list miss a page Bunny really uses?

No.
- The only `loadURL` is `${origin}/src/ui/index.html` (`main.js:134`). The server redirects `/` to it.
- `src/ui` has exactly 5 `.html` files, and they are the 5 on the list. Four of them run in `#settings-frame`.
- Every in-app navigation goes to `./index.html?s=…`, `./providers.html`, `./automation.html` or `./settings.html`.
- The query and the hash are ignored: the check compares `pathname` only. The probe confirms `index.html?s=abc#top` has the bridge.
- The app reads only `s`, `embed` and `section` from the URL. Each only chooses what is shown.
- Attachment and file previews are not own pages. If one ever opens a window, it is a `plain` window: no bridge, which fails safe.
- The quick-ask bar is `file://` with its own preload, and is unchanged.

Spellings, from `sec-artifact-window-next-steps-fixvariant.cjs`:

| Address | Own page? |
|---|---|
| `../ui/index.html` | true (resolved by the parser) |
| `%2e%2e/ui/index.html` | true (resolved by the parser) |
| `/SRC/UI/INDEX.HTML` | false, fails closed |
| `index.html/` | false |
| `index.html%00` | false |
| `raw?/src/ui/index.html` | false |
| `raw#/src/ui/index.html` | false |
| another port | false |
| `localhost` instead of `127.0.0.1` | false |

The two lists (own-pages.js and preload.cjs) are kept equal by `test/own-pages.test.js`.

### (2) The `plain` window

`childWindowOptions('plain')` sets `preload: undefined`, `sandbox`, `contextIsolation` and no Node. The bridge is gated twice:
- the window gets no preload;
- the preload itself exposes nothing outside an own page. The Builder's case 3 loads it into `/api/artifacts/zzz/raw` and gets `undefined`.

Every IPC check uses the new `isOwn`.

What an artifact can do next. The real raw CSP allows popups, and main.js's `will-navigate` is applied to every window:

| The artifact... | Result |
|---|---|
| calls `window.open('/src/ui/index.html')` | opens a real Bunny window. The artifact cannot script it: `SecurityError`, because its origin is opaque. |
| steers that window with `w.location = '/api/artifacts/evil/raw'` | the window lands there with `bunnyDesktop` `undefined`. The preload's own gate holds. |
| opens another artifact address | `plain`, no bridge |
| navigates itself to `/src/ui/settings.html` | still no bridge, because the window has no preload |

### SB1-a (defect, for the Builder; not a security hole): as built, "Open" shows an empty window

With main.js's real `will-navigate` (`if (!isOwn(url)) preventDefault + openExternal`), the new window's first load of `/api/artifacts/<id>/raw` is itself a `will-navigate`. It is refused and handed to the person's browser, and the Bunny window stays blank. The as-built probe (`sec-artifact-window-next-steps.cjs`) shows:

```
DEBUG windows: [ '<origin>/src/ui/index.html?s=abc#top', '' ]  external: [ '<origin>/api/artifacts/a1/raw' ]
```

The Builder's smoke probe installs no `will-navigate`, so it could not see this.

This is still safe. No bridge is anywhere, and in the person's own browser the raw page is CSP-sandboxed with an opaque origin and no token. But it is not what the row says, and it leaves an empty window.

**Fix:** in `will-navigate`, refuse only what is not on Bunny's server: `if (!isOwnOrigin(url, origin))`. The bridge stays gated by the preload and by IPC `isOwn`. I ran my probe with exactly that change (`-fixvariant.cjs`): `SEC PROBE PASSED: 16 of 16`, including the steering case. That change needs a Security re-stamp. It is quick, because the probe is ready.

## SB-2 at dbbf1dc: PASS

- Print now uses a hidden `<iframe sandbox="allow-scripts allow-modals">`. The sandbox is set with `setAttribute` from `PRINT_SANDBOX`, with no `allow-same-origin`, no popups and no top navigation.
- It draws `printDocument(shown)` through `srcdoc`, so the frame's origin is opaque and its handlers cannot reach Bunny. This matches the artifact frame, which got a `SecurityError` reading its parent in the settings-bridge probe.
- A text artifact and the title are HTML-escaped.
- There is no `window.open('')` and no `innerHTML` into a window of Bunny's origin any more.
- `allow-modals` is needed for `print()`. LOW: a page could call `print()` repeatedly. That is a nuisance only.
