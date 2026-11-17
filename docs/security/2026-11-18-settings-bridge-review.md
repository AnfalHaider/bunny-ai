# SETTINGS-BRIDGE at 1d16eb6: Security PASS, plus one new HIGH that this commit did not cause (SB-1)

Branch `claude/builder-a-settings-bridge`. The commit sits on top of main at 8b49c55. It changes these files:
- `src/ui/api.js`: adds `desktopBridge()`;
- `src/ui/customize.html` and `src/ui/settings.html`;
- `src/server/appTools.js`: `findInstalled`;
- two tests.

`electron/main.js` and `electron/preload.cjs` are unchanged.

## The probe

`docs/security/settings-bridge-probe/main.cjs` is a stand-alone Electron 45.3.2 app, the same version as Bunny's. It contains no Bunny code and no profile. It uses the same `webPreferences` as `electron/main.js` (preload, `contextIsolation`, `sandbox`), the same `setWindowOpenHandler` rule (`isOwn` means allow, with the preload), and a preload that exposes one function through `contextBridge`.

```
PING child-via-parent                senderFrame.url=<origin>/    mainFrame=true isOwn=true
PING report art:blocked: SecurityError
PING raw-own-bridge                  senderFrame.url=<origin>/raw mainFrame=true isOwn=true
WINDOW <origin>/raw title(typeof bridge)=object
```

## Answers

**(c) Is senderFrame still the main frame when the call goes through the parent's bridge?**

Yes. When a same-origin child calls `parent.bunnyDesktop.secureWrite`, main sees `senderFrame` as the main frame and its URL as `<origin>/`. The bridge function belongs to the main frame's world, so main cannot tell which frame called it. Security therefore rests on which frames can be same-origin with the main window. This is not new: any same-origin child could always read `parent.bunnyDesktop`, and `settings.html` already did so for the updater and the desktop section before this commit.

**(b) Is the same-origin parent test enough?**

For the frames inside the main window, yes.
- The UI has only two iframes.
- `#settings-frame` loads only the fixed `SETTINGS_PAGES` or `./settings.html`, with the section URL-encoded into the query (`chat.js:3758`).
- The artifact frame is `sandbox="allow-scripts allow-forms allow-modals"` with no `allow-same-origin` (`chat.js:3323`). The probe's frame with those flags gets a `SecurityError` reading its parent, so it has no bridge. The sandbox survives the frame navigating itself.
- The browser panel is a separate `WebContentsView` in `persist:bunny-browser` with no preload. It is not a child frame.
- The `try/catch` and the origin comparison are correct. `desktopBridge()` is a convenience for Bunny's own pages, not the security control; main's checks are.

**(a) Can any frame that is not Bunny's own now reach secureWrite?**

Not through this change. One window that is not really Bunny's page could already reach it, and still can: see SB-1.

**findInstalled:** it now compares lowercased owner/repo. It is used only to refuse a second install (`appTools.js:120`), so it can only refuse more. No finding.

Verdict for the piece: **PASS at 1d16eb6.**

## SB-1 (HIGH, existed before this commit, already in v0.1.9): an artifact opened with "Open" gets the desktop bridge

1. `chat.js:3265` calls `window.open('/api/artifacts/<id>/raw', '_blank', 'noopener')`.
2. The URL is Bunny's own origin, so `setWindowOpenHandler` (`main.js:95`) allows it as a new BrowserWindow with `webPreferences()`, which includes the preload.
3. The raw route serves the model-written HTML with `content-security-policy: sandbox allow-scripts ...`. The probe shows that the preload's `contextBridge` still exposes the bridge in such a page (`typeof bridge` is `object`), and main sees `senderFrame.url` as `<origin>/raw`, which passes `isOwn`.

So the artifact's own script can call `bunnyDesktop.secureWrite` with any window-only route, such as the permission mode or permission rules, once the person clicks Open. The same page can also use:
- `prefs:set`;
- `browser:act` and `browser:view`, if `senderAllowed` accepts it (it uses the same `isOwn` test);
- `pickFolder` and `updates.install`.

I probed this with the stand-alone app, not in Bunny itself. Each step matches Bunny's code above.

**Fix (Builder; changes a security control, so it needs the owner's go):**
- In `main.js`, `isOwn` for IPC should accept only Bunny's page paths (`/`, `/index.html` and the Settings pages): an allow-list, never `/api/*`.
- `setWindowOpenHandler` should open `/api/*` URLs (artifact raw) without the preload, or in the person's own browser.
- Add a test that a window at `/api/artifacts/<id>/raw` gets no `bunnyDesktop`, and that `secure:write` from that URL is refused.

## SB-2 (MEDIUM, existed before, browser mode only, not probed): the artifact "Print" writes model HTML into a same-origin popup

`chat.js:3268` opens `about:blank` and sets `body.innerHTML = shown.body`.
- In the desktop app, `setWindowOpenHandler` denies `about:blank`, so nothing opens.
- In a plain browser the popup is Bunny's origin, and `innerHTML` still runs event-handler attributes (for example `<img onerror>`). A model-written page could then read the token from `/` and call the API, though not the window-only routes.

Fix: print from a sandboxed iframe (`srcdoc`, no `allow-same-origin`), or print `/raw`.
