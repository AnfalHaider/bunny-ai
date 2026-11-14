---
id: L005
date: 2026-11-15
session: builder
title: A redesign keeps the tested hooks, even when every DOM node moves
triggers: [ui, ux, sidebar, rail, composer, playwright, e2e, i18n]
files: [src/ui/app.css, src/ui/index.html, src/ui/chat.js, src/ui/i18n.js, e2e/shell-ui.spec.js]
cost: 1d
evidence: 'The chat shell was rewritten to feature parity (warm palette, serif greeting, composer card, right-aligned bubbles, project tree, session rail). Every e2e selector (#new-chat "Nuevo chat", #send "Enviar", #sessions .session-row counts, #picker-button /no models/i, .pin count 1, data-depth nesting, #empty-text /provider/i, .picker-empty, #slash .slash-item count 5, #artifact-count, #stop hidden, #error/#status/#context-text) survived unchanged. 219/219 unit, 67/67 browser tests pass; tally 82/84.'
status: live
---

**What happened.** Bunny AI's UI was dark and generic, unlike the reference app, and it
was missing chrome the owner sees in the reference app (session rail, project tree, date
buckets, greeting, chat title in the topbar). I rebuilt the shell while keeping
every DOM hook the 62 Playwright tests depend on: exact IDs, exact i18n text,
exact aria-labels, exact classes.

**The rule.** When you redesign a screen that e2e tests drive, treat each tested
selector as a contract. Don't renumber, don't rename, don't drop a wrapper the
test selects. If the test reads `#new-chat` as "Nuevo chat", keep an element
whose visible text is exactly "Nuevo chat" — an SVG icon plus a `<span
data-i18n>` inside works, but replacing the text node does not.

**Corollaries**

- `flash()` wipes SVG children via `textContent`. When a button's artwork is an
  SVG, flash the `.sr` span inside it instead of the button node.
- A selector like `.side-group` matches anything with that class, including new
  classes you add (`side-group project-head`). Test what `.first()` actually
  returns; scope with `.side-group.sub` when you need the second tier.
- When no project is set, render `rail-empty` not `rail-value` — a test
  selecting `.rail-value` finds nothing. Name the state in the class, not just
  the text.
- Frontend files are served static: edit `chat.js`, `i18n.js`, `app.css` or
  `index.html` and reload the page. No server restart is required for frontend
  changes.
- Verification order: `node --check`, `node --test test/` (219/219), restart
  server, `npx.cmd playwright test` (67/67), then visual screenshots in light
  and dark. Do the cheap checks first; the browser suite is the expensive one.
