# L-1 layout audit: Settings and Customize at main 4995d5f

Design, 2026-11-17. Asked by the Chief of Staff after the owner's screenshot of Settings → Code.

## How it was done
Build `4995d5f` extracted with `git archive`, run on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). Every Settings section (Profile, Usage, Appearance, My Dear Bunny, Language, Notifications, Privacy, Capabilities, Models, Connection, Code, About) plus Providers, Customize and Automation, shot as the embedded page the Settings window shows (`settings.html?embed=1&section=…`), at 800 px (the content pane of a 1280 window) and 390 px, light and dark: 64 full-page shots. A script also measured, in each, every text and control against the edge of its bordered card (flag when under 9 px), plus page overflow (`shots/audit2.json`). I then looked at each page in light at both widths and at the pages the script flagged in dark. The two sources named below are `docs/design/bunny-app-bindings.css` (design) and its copy `src/ui/app.css`; both carry the same rule at the same place, so one fix goes in both.

Kept in `shots/` only the pictures the items below point at.

## Items (Builder A)

### 1. HIGH: Code → Permission rules runs to the card edge (the owner's report)
- **Selector:** `.group > .rules#perm-rules` and everything in it: `.rules h3`, `.rules .lead`, `.rules .tabs2` (the All folders / One folder switch), `.rules .rl` (Deny / Ask / Allow lists), `.rules .addr` (add row and the "Start from" row), `.rules .try`.
- **Where:** `docs/design/bunny-app-bindings.css:1081-1110` (`src/ui/app.css:2062-2091`); markup `src/ui/settings.html:455`.
- **Cause:** every other row in a `.group` is `.group > .row` with `padding: var(--sp-7) var(--sp-8)` (`bunny-app-bindings.css:351`). `.rules` is a bare `div` inside the group, so it has no padding at all: the heading and text sit 1 px from the card border, the pill switch is 4 px from it, the three lists touch both sides, and the dashed "Start from" and the "Try a command" boxes touch the edge too.
- **Today:** `shots/code-d-light.png`, `code-d-dark.png`, `code-m-light.png`, `code-m-dark.png`.
- **Intended fix:** give the block the same padding as a row: `.group > .rules { padding: var(--sp-7) var(--sp-8); border-top: 1px solid var(--line); }` (the line between it and "Default permission mode", like `.group > * + .row`). Then drop the `margin-top` of `.rules h3` to 0 so the title does not sit lower than a row title. Keep the lists (`.rl`), the add row and the Try box at the full inner width, so their left and right edges all line up with the paragraphs above them, 24 px (`--sp-8`) in from the card on desktop. On the phone use `var(--sp-6)` sides so the text is not squeezed. The add row (Command, pattern, Allow, Add rule) may wrap on the phone; Add rule goes last and stays inside the padding.
- **Done when:** in light and dark, at 800 and 390, no text, switch, list, box or button in the block is closer than the padding to the card edge, and the left edges of heading, paragraphs, switch, lists, add row and Try box are one vertical line.

### 2. HIGH: Privacy → Storage text sits on the card border
- **Selector:** `#storage.group > .kv`, children `.k` and `.v`.
- **Where:** `docs/design/bunny-app-bindings.css:400` has the right rule (`padding: var(--sp-6) var(--sp-8)`), and `:1026` (`src/ui/app.css:1361` and `:2007`) is a later `.kv` for the Session pane with `padding: var(--sp-2) 0` that wins because it has the same specificity and comes later. The markup for the Session pane is `src/ui/index.html:268-278`.
- **Cause:** two unrelated components share the class `kv`; the Session pane's tight padding overrides the settings row's.
- **Today:** `shots/privacy-d-light.png`, `privacy-m-dark.png` (Sessions, Secrets, Server labels flush left, values flush right, 1 px from the border).
- **Intended fix:** scope the Session pane's rule to its own container (`.rail-card .kv` or whatever wraps `index.html:268`), or rename it, and leave `.kv` at 400. Result: the three rows get `--sp-6`/`--sp-8` padding like every other settings row.
- **Done when:** labels sit 24 px in from the left border, values 24 px from the right; the Session pane in the app looks the same as before (check it).

### 3. MEDIUM: Appearance → Code: the two theme pickers and previews are 4 px out of line with the rows
- **Selector:** `.code-theme-pick` (inside the `.group` under `h2#code-look`), holding `#code-theme-light`/`#code-theme-dark` and the two `.code-preview`.
- **Where:** `docs/design/bunny-app-bindings.css:874` (`src/ui/app.css:1853`); markup `src/ui/settings.html:135`.
- **Cause:** `padding: var(--sp-5) var(--sp-6)` (16/20), while the rows under it use `var(--sp-7) var(--sp-8)` (bindings:351); so the pickers start at x=37 and the row text at x=41, and end at 762 against 759.
- **Today:** `shots/appearance-d-light.png`.
- **Intended fix:** give the grid the row padding `var(--sp-7) var(--sp-8)`, same gap between the two cards, so the pickers' outer edges line up with "Code font" and the toggles/selects below.

### 4. LOW: Providers → footnote touches the list card
- **Selector:** `.page > p:last-child` (the "Keys are encrypted with Windows DPAPI…" note), `src/ui/providers.html:35`.
- **Where:** `docs/design/bunny-app-bindings.css:384` (`.page > p:last-child` margin) and `:394` (`.note`); `src/ui/app.css:1355`.
- **Cause:** the note is followed by `p.note.page-links` (hidden in the embedded window, but still the last child), so the `:last-child` margin goes to the hidden link and the note has none.
- **Today:** `shots/providers-d-light.png` (bottom of the page).
- **Intended fix:** the note gets `margin-top: var(--sp-6)` and sits on the same left edge as the card (it already does); check it is not the cascade that is wrong.

### 5. LOW: Capabilities → "No tools built yet." is spaced differently from every row
- **Selector:** `.group > .row.desc` made in script at `src/ui/settings.html:917` (`textContent: 'No tools built yet.'`).
- **Where:** `docs/design/bunny-app-bindings.css:351` (`.group > .row` padding) plus `.desc` margins; it is a full row with one dim line and no title.
- **Today:** `shots/capabilities-d-light.png` (bottom card: a large empty gap above and below one dim line).
- **Intended fix:** a quiet line inside the row above it, or a row with the standard height and the dim text vertically centred. Not urgent.

## Checked, no problem found
Profile (including the "Sign-in apps (advanced)" block opened, at 390), Usage, My Dear Bunny, Language, Notifications, Models, Connection, About, Customize (empty state, both widths), Automation, Providers (all but item 4). In dark the same pages differ from light only in colour; items 1 to 3 repeat there.

## Not covered (UNKNOWN)
- **Desktop app** section: it is hidden outside the real Electron window, so it was not shot.
- **Customize with connectors, skills and plugins present** (the `.auto-card` list): the invented profile had none; `src/ui/app.css:1900` gives that card its own padding, but I did not look at it filled.
- **Settings window itself** (the left list, the Search box, the top bar) was seen in the Code shot at 1280 and looked fine; not looked at on a phone-width window.
- The script's phone "outside the card" hits on Profile come from the closed Sign-in apps block; with it opened nothing overflows.

## Review of the fix: claude/builder-a-l1 at fca5fb3 (2026-11-17): PASS
Shot on an invented profile, desktop (800 px content width) and phone (390), light and dark, `shots-fix/`. The measuring script flags nothing new; Privacy is no longer flagged.

1. **Permission rules: fixed.** Block padded like a row, divider above it; text, switch, lists, add row, "Start from" and Try box all sit 24 px in on desktop and share one left edge with the rows below (heading at 41 px, the same as "Default effort"). Light, dark, phone.
2. **Privacy Storage: fixed.** Labels and values 24 px in; the Session pane keeps its own tight `.kv` (4 px and 0 padding, 92 px label) because that rule now lives under `.pane-section`.
3. **Appearance code pickers: fixed.** Lined up with the rows below, desktop and phone.
4. **Providers footnote: fixed.** 12 px below the list.
5. **Capabilities "No tools built yet.": partly.** It now has row padding, but the line still sits low in the card with a large gap above it. Not blocking.

Two small notes, neither blocking: (a) on the phone the Permission rules block is inset 20 px (`--sp-6`, which I asked for in item 1) while the rows are inset 24 px, so its text starts 4 px left of the row text (37 px against 41); my spec was wrong, use `--sp-8` there too. (b) The "No rules." lines touch their own list border by design (they are rows in a list card).

## Re-check on the release candidate 88b6082 (2026-11-17): PASS
Same pages shot again from `claude/release-0.1.9` at 88b6082 (invented profile, 800 and 390 wide, light and dark): `shots-cand/`, readouts in `shots-cand/log.txt`. The candidate adds the spec fix (5235a0f) only in the test; the CSS is as at fca5fb3.
- Permission rules: heading, switch, lists, add row and Try box all start at one left edge (41 px desktop, 37 px phone); no page overflow. Privacy label 17 px in from the card edge (the card's own 1 px border plus its padding; text no longer flush). Providers footnote 12 px below the list. Capabilities "No tools built yet." is a 47 px row.
- Unchanged and not blocking: on the phone the Permission rules text starts 4 px left of the other rows (37 against 41 px, `--sp-6` against `--sp-8`, `src/ui/app.css:2068`); the Capabilities empty line still sits low.
