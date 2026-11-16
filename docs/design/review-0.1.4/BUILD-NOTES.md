# D1 build notes (Builder)

Source of truth: `index.html` in this folder (toggle Light/Dark and 1440/390). Owner approved 2026-11-16: fixes 1, 3, 7, 8, and "the bunny should be purple". All LOW. Edit `docs/design/bunny-app-bindings.css` (or the template HTML), then `node scripts/build-css.mjs` into `src/ui/app.css`; keep every tested id and i18n key (see lesson L005). Nothing else on these screens changes. Pass screens (zoom row, My Dear Bunny, Code rows) get no change except the shared phone section list in item 2.

## 1. Greeting and empty chat (`src/ui/index.html:163-167`, `src/ui/chat.js:3336`, `app.css:1874-1877`)
- `.empty-title` (the "Pick a model, then tell me what you need." line): `font-weight: 400; color: var(--text-dim); font-size: var(--fs-md)`.
- When there are no models, `chat.js:3336` stops writing "No models yet. Add a provider in Providers." into `#empty-text`. Instead show one primary button "Add a provider" linking to `./providers.html`, placed after the title, `margin-top: 12px`, padding 8px 16px, radius 8px, the app's primary button look (`background: var(--text); color: var(--bg)` in the shot; use the existing `.primary` class if it renders the same). The old line goes away. Keep the `empty-text` id for the normal (models present) text. Add the i18n key for the button label to all four language blocks.
- Models present: no change.

## 2. Settings section list on phone (`app.css:1411`, `index.html:415-440`)
Phone only (the existing narrow breakpoint at `app.css:1411`): `.settings-nav` loses `max-height: 40vh`, gets `padding: 8px 12px; gap: 0`; `.settings-search` and `.settings-sep` are `display: none`; `.settings-nav-list` becomes `flex-direction: row; overflow-x: auto; gap: 4px; scrollbar-width: none`; `.nav-row` gets `white-space: nowrap; flex: none; border-radius: 999px; padding: 7px 14px`. The active row is scrolled into view when a section opens (`scrollIntoView({inline:'center', block:'nearest'})`). Desktop unchanged. Check Settings search still works on desktop and that opening a section from elsewhere (e.g. "Open Appearance") still selects the row.

## 3. Custom provider form (`providers.html:21-30`)
Move the whole "Add a custom provider" block (heading and card) to directly after the "Connected providers" block and before "Popular providers". Heading text: "Add a custom provider (any OpenAI-compatible server)" (add i18n for all languages: `providers.customTitle`). Form markup, ids and the submit handler (`:311-330`) unchanged. The footnote about DPAPI stays at the bottom.

## 4. Automation Add buttons on phone (`automation.html:37,45,59,77,91`)
On phone, every `button.primary[type=submit]` in `.automation-page` is full width (`width: 100%; display: block`), including "Add local connector" and "Add skill". Desktop unchanged.

## 5. Bunny purple (`app.css:1772-1775`, `bunny-app-bindings.css:824-827`)
Replace the four hard-coded fills with tokens, no new colour:
```
.bunny-working .ear  { fill: var(--accent); fill-opacity: .55; }
.bunny-working .face { fill: var(--accent); }
.bunny-working .eye  { fill: var(--on-accent); }
.bunny-working .nose { fill: var(--on-accent); }
```
Grumpy and reduced-motion rules unchanged. Pictures: screens 6 and 6b.

## Evidence Design needs back (O8)
Shots of the built screens from an invented profile only (`BUNNY_DATA_DIR` temp, `BUNNY_FAKE_UPSTREAM=1`): greeting with and without a model, Settings on phone, providers page top at 1440 and 390, Automation on phone, the bunny normal and grumpy; each light and dark at 1440 and 390. Design compares them against the artifact and signs off or rejects drift.
