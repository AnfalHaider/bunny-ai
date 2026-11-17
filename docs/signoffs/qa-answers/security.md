---
piece: qa-answers
role: security
sha: 7eb62e7
verdict: PASS
date: 2026-11-17
---

# SB-1 re-stamp at 07b6e6a, and QA-ANSWERS (ab71399, 58dc489, 8b881e6, 7eb62e7): Security review

Real Electron 45.3.2 with invented userData folders and stand-in servers. No Bunny profile was used.

## SB-1 at 07b6e6a: PASS (supersedes 3e8f598; SB1-a fixed)

`will-navigate` now refuses only `!navigationAllowed(url, origin)`, which is `isOwnOrigin`. This is exactly the change I probed as the fix variant. Every IPC check still uses `isOwn`, which is the page allow-list.

- **My probe** `sb1-probe/test/probes/sec-artifact-window-next-steps.cjs` now uses the shipped rule, with 07b6e6a's `own-pages.js` and `preload.cjs`: `SEC PROBE PASSED: 16 of 16`. The artifact window opens with no bridge. An artifact cannot script the Bunny window it opens (`SecurityError`). Steering that window to an artifact address leaves no bridge, and an artifact window navigated to `settings.html` has no bridge. Every spelling case passes.
- **Builder's probe** `artifact-window-smoke.cjs` at 07b6e6a: `PROBE PASSED: 12 of 12`. The artifact window renders, no navigation was refused, it has no bridge, `secure:write` fails, and other sites are still refused.

## QA-ANSWERS at 7eb62e7: PASS

**Builder's probe** `test/probes/quick-ask-answers-smoke.cjs`, run from a temporary copy of 07b6e6a: `PROBE PASSED: 19 of 19`. The hostile reply carries `<img onerror>`, a `javascript:` link, `<script>` and a remote image. No script ran, nothing interactive survived, the request was text-only with no tools, the bar never navigated, there is no Allow button, and the "needs Bunny's window" card was shown.

### (1) Can a text-only chat be steered into using tools?

No.
- With `textOnly`, `tools` is `null` (`app.js:3015`), so `offerTools` is false (`chat.js:84`).
- With `offerTools` false, a round ends at `chat.js:198` without running anything. A model that sends `tool_calls` anyway, or writes them out as text, gets nothing run: text-written calls are parsed only when `offerTools` is true (`chat.js:170`).
- The bar cannot reach the server itself. Its CSP is `default-src 'none'`, it is a `file://` page with no token, and every ask goes through main's answerer, which always sends `textOnly: true`, `workMode: 'chat'`, the text and the checked attachment. It never sends `useSkill`, `browserControl`, a folder or a mode.
- The chat is created with only a title, `workMode` and `origin`, so it starts in Ask mode with no folder.
- **A later message in the same chat from the main window** is an ordinary message: tools come back under that chat's own mode and cards, which is the person acting in Bunny's window. `textOnly` is not saved on the chat. The text-only system note is not kept in the history.
- Any `permission`, `question` or `capability` event aborts the request and shows the needs-window card.

### (2) Is fromBar strong enough?

Yes. It requires all three:
- the bar is alive;
- `event.sender === bar.webContents`;
- `senderFrame.url` matches `^file://.*/quick-ask/bar\.html$`.

The bar cannot hold frames, because its CSP has no frame source. It cannot navigate: `guard()` refuses anything that is not on Bunny's server, and the probe shows "the bar never navigates". So no other page can be the sender.
- `resize` clamps the height to between 300 px and 560 px, and to the screen.
- `open` passes only main's own `sessionId`. The window accepts `openChat` only when it matches `^[a-f0-9-]{36}$`.

### (3) Is the hostile-markdown handling complete?

Yes.
- `renderMarkdown` escapes all text first (`markdown.js:32`). The only markup it then builds is `<a>` (https or mailto only), `<img>` (https, or `data:image/png|jpeg|webp|gif;base64`), `<strong>`, `<em>`, `<del>` and `<code>`, plus code blocks built with DOM calls.
- So no raw HTML, `style`, SVG, `<use>`, `foreignObject` or event handler can come from a reply.
- In the bar, every `<a>` becomes a `<span>` with the address only as its title. `img`, `iframe`, `object`, `embed`, `script`, `link`, `form`, `input`, `button`, `video` and `audio` are removed.
- The CSP is a second wall: `default-src 'none'`, only the bar's own script runs, nothing loads from the network, and images are `data:` only.
- CSS: the CSP allows `style-src 'unsafe-inline'`, but no reply text can produce a `style` attribute or element. The bar's own icons are fixed SVG strings parsed as SVG, never reply text.

### (4) The chat kept after Esc

Esc stops the answer and resets the bar, and the chat is kept. It carries only:
- the person's message and its one attachment;
- the model's text, including a `[[NEEDS_BUNNY_WINDOW]]` line, which is just text;
- the `origin: 'quick-ask'` tag. `sessions.create` keeps this tag only when it is exactly `quick-ask`, so it is a label and nothing else.

No mode, folder, rule or "text only" setting carries over. Opened in the main window, the reply is drawn by the same `renderMarkdown` as any chat. Links work and https images load there, the same as every other model reply. It is unchanged, not new.

### Notes (LOW)

- In text-only mode the system message still contains the mode text ("you can search the web ... call request_capability"), next to the text-only note. It is harmless, because no tool exists, but the model may answer with the needs-window marker more often than needed. A small wording fix for later.
- `POST /api/sessions` accepts `origin: 'quick-ask'` from any caller that passes the request guard. It is only a label in the list.
