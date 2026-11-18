---
piece: theme-apply
role: security
sha: 35fdb6a
verdict: PASS
date: 2026-11-18
---

# FONTS (9dcf0a0) and THEME-APPLY (35fdb6a) review (Security): PASS for both

Branch claude/builder-b-v0113-fonts-theme. I read the code diff. On an extract of 35fdb6a with an invented profile, `fonts` and `theme-shell` pass 7 of 7.

## FONTS, 9dcf0a0: PASS

- **Nothing new is reachable.** The static handler already served every file under `src/ui/`, inside the root (`normalize` and prefix check), using `application/octet-stream` for unknown types. The change only gives `.woff2` and `.txt` their real types (`font/woff2`, `text/plain`). No route was added.
- **Devices.** A device that has not signed in gets 302 to the sign-in page (test line 81). A signed-in Chats device gets the fonts and licences like any other UI file.
- **Service-worker rule.** It adds only `src/ui/fonts/<name>.(css|js|svg|woff2?|ttf)`. `[\w.-]` blocks any `/`, so no deeper path or `..` matches. The `/api` paths and pages (`text/html` is refused before the pattern, and `.html` is not in it) stay uncached, and the token, signin and remote script exclusion still applies. Licence `.txt` files are not cached (test line 104).
- **No requests to Google at runtime.** `@font-face` uses only the relative `fonts/...woff2`. The gstatic URLs are provenance in `manifest.json`. Settings maps font choices through a fixed table (`FONTS[...]`), so a setting value never reaches CSS directly.
- **About → Licences** builds links with `textContent`, `target=_blank` and `rel=noopener`. A `.txt` under `/src/ui/fonts/` is not one of the five own pages, so `openDecision` gives it a plain window with no bridge.

## THEME-APPLY, 35fdb6a: PASS

- **The `theme:set` IPC checks the sender.** It refuses unless `isOwn(event.senderFrame.url)` and the theme is one of `light`, `dark` or `system`. It only sets `nativeTheme.themeSource`, window background colours (from a fixed table) and the saved `prefs.theme`. The preload exposes `setTheme`, and the bridge exists only on own pages, so artifact windows (SB-1) don't get it.
- **postMessage.**
  - The chat page refuses any message whose origin is not its own. The receiver in `api.js` also checks `e.origin === location.origin` and refuses its own window as source.
  - Artifact frames and raw pages run in a sandbox without `allow-same-origin`, so their origin is `null` and they are refused. A device page is on the LAN origin, not the window's.
  - What gets through is cosmetic only. `applyAppearance` maps every value through a fixed table, the code font is stripped of `"';{}<>`, and the code size is range-checked. The settings themselves are then read back from the server, never written.
- **`theme-boot.js` and the theme-color meta.** Boot reads `localStorage['bunny.theme']` and accepts only `light` or `dark`. The meta's colour comes from a fixed table.
- **Child windows** now get `backgroundColor` only. Their `webPreferences` are unchanged.

## Note, not blocking (from before this change)

`prefs:set` in `electron/main.js` takes `(_event, patch)` with no `isOwn` check. Its siblings `theme:set`, `app:open-browser` and `secure:write` all have one. The patch is built from a typed allow-list, and the bridge exists only on own pages, so nothing can reach it today. I recommend adding the same sender check in a later release for consistency.
