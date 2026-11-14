---
id: L001
date: 2026-11-12
session: builder
title: Browser tests find the bugs the code hides
triggers: [playwright, e2e, aria, render, test]
files: [src/ui/providers.html, src/ui/app.css, src/ui/chat.js, e2e/app.spec.js]
cost: 1h
evidence: 'e2e/app.spec.js caught ten Connect buttons announced identically (Object.assign never reflects aria-*), a click lost to a full re-render, and form.inline{display:grid} beating the browser own [hidden] rule.'
status: live
---

Three defects in the providers screen survived unit tests and were only found by
driving the real page:

1. `Object.assign(el, { 'aria-label': ... })` sets a JavaScript property, not an
   attribute, so every connect button was announced as "＋ Connect".
2. Re-rendering the list on every click lost the click and threw away whatever
   had been typed into the form.
3. `form.inline { display: grid }` is an author rule, so it beat the browser's
   own `[hidden] { display: none }` — all ten forms were on screen at once.

**Why:** a unit test checks the function; only a browser checks the rules the
browser applies. Author CSS beats user-agent CSS, and `aria-*` is an attribute,
not a property.

**How to apply:** when a screen has a list, keep the rows in the DOM and toggle
`hidden`; when an element needs an ARIA name, set the attribute; when a style
rule sets `display`, add the matching `[hidden]` rule by hand.
