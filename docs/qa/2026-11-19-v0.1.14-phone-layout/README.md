# v0.1.14 PHONE-LAYOUT walk: breaks found on main c7077ee

QA, 2026-11-19. Invented profile only (a scripted model, the name "Pat"), never the real profile or the real network. Pictures are in `pictures/`.

## How it was measured

- Chromium with Playwright mobile emulation (touch, mobile user agent, device scale 1), the app served by the real server code on an invented profile.
- Widths 360, 390, 412 and 720. Heights 640, 740, 915 and 1280. Landscape 640x360, 740x360, 844x390. Keyboard-open heights 360x340, 412x380 and 720x520.
- Both themes (light on every size, dark on 360x640, 412x740, 720x740, 640x360).
- Four ways in: the browser view on the PC's own address, a device signed in at **Chats** and a device signed in at **Everything** (over 127.0.0.2, the remote-device path), and the **installed web app** (standalone display mode emulated).
- 1,584 states measured: new chat, an open chat with a list, code and a table, the sidebar, the model picker, `+` menu, Export, the Job, Permission and Effort menus, Code mode and its Terminal, Changes, Browser, Files and Tasks panels, Artifacts, Projects, Incognito, the account menu, a chat row menu, search, the Settings window and each of its 16 tabs, and the Providers, Customize and Automation pages, plus the sign-in and offline pages. Every frame, so each Settings iframe too.
- For each state: the page scrolling sideways, a control cut off by the screen or by a clipping parent, controls on top of each other, a control with another element on top of its middle, a label cut off, targets under 30 px.
- `automated-grouped-report.md` is the machine list (102 raw groups were cut to 27 by dropping hidden or scrollable-by-design items; some are not breaks, see "Dropped" below).
- Scripts: `e2e/w0114-harness.mjs`, `e2e/w0114-phone.mjs`, `e2e/w0114-report.mjs`, `e2e/w0114-shots.mjs` (evidence branch).

## What was not seen (and why it is UNKNOWN)

- **The composer running off the bottom with Send cut, the chip under Send.** In emulation the composer box, the + / mic / model chip / Send row and the row under it all fit on screen at every size and do not overlap (checked at 360x640, 360x740, 390x740, 412x740, 412x915, 720x740, 720x1280 and landscape). The owner's picture needs a real phone: Chrome's moving address bar changes what `100vh` means, and Playwright cannot move it. `app.css:232` has `height: 100vh; height: 100dvh;` so a Chrome that knows `dvh` should be right; one that does not, or the installed app's safe-area insets (not emulated), may differ. Builder A should test on the owner's phone, or add `interactive-widget=resizes-content` / `visualViewport` handling and a fallback.
- **The on-screen keyboard.** Emulated by shrinking the layout viewport (the composer stayed on screen at 360x340 and 412x380). Chrome on Android shrinks only the visual viewport by default, so this does not prove the real keyboard case.
- **Real touch scrolling momentum, pinch zoom, and the OS share sheet.**

## Breaks (ordered by how much they hurt)

### F1. The top bar spills off the right edge at 360, 390 and 412 wide (the owner's "seven controls, Export as a word")
- Page: every chat screen (new chat, open chat, sidebar open, menus). All four ways in, both themes.
- Element: `div.toolbar` holds `button#export` ("Export" as a word), `button#rail-toggle`, five `button.icon-btn` (Terminal, Changes, Browser, Files, Tasks and plan) and `button#popout`. At 360 the strip shows Export + 5 icons and "Tasks and plan" and the pop-out button are off the edge; at 390 the pop-out is fully hidden and "Tasks and plan" sits at the edge; at 412 the pop-out is cut in half (box x 378..418 on a 412 screen). Nothing wraps, nothing says the strip scrolls.
- Also at 412x380 and 360x340 with the keyboard open. 720 wide and landscape (640 and up) fit.
- Pictures: `pictures/F1-topbar-360x640-light.png`, `F1-topbar-390x740-light.png`, `F1-topbar-390x740-dark.png`, `F1-topbar-412x740-light.png`; the fitting case `F1-ok-720x740-light.png`.
- Design's note (390 px, "the new chip pushes the chat title out") is this strip. A chat title is not shown in the strip in the new-chat state I measured; with an open chat the title sits inside it, see below if Design has a picture.

### F2. The "Auto · Chat" Job menu opens off the right edge and over Send at 412 wide
- Page: new chat, tap "Auto · Chat" under the composer. 412x740 and 412x915 (the row fits on one line there, so the menu is anchored to its button at x 288).
- Element: `div#job-menu`, 286 px wide, left edge x 288 on a 412 screen: about 160 px of the menu (descriptions, the tick) are off screen, and it sits over the model chip and Send. Its list is longer than the space: Speech/See/Research rows are cut at the bottom and reached only by scrolling the menu.
- At 360 wide the menu fits across (left edge 16) but still covers the composer (`F2-jobmenu-360x640-dark.png`).
- Pictures: `pictures/F2-jobmenu-412x740-light.png`, `F2-jobmenu-360x640-dark.png`.

### F3. The row under the composer wraps at 360 and 390 wide
- Page: new chat. `Manual`, `Window only`, `Medium` and `Auto · Chat` are one row at 412 and above; at 360 and 390 `Auto · Chat` drops to a second line, taking more height under the composer (touching the bottom at 360x640).
- Pictures: `F1-topbar-360x640-light.png`, `F1-topbar-390x740-light.png` (the second line is visible at the bottom).

### F4. "Pick a model" is shown while a model is chosen
- Page: new chat with `gpt-4o` selected: the chip reads gpt-4o and the empty state still says "Pick a model, then type below." (Some greetings also say "Pick a model, then tell me what you need.") Seen on every new-chat picture. The Auto case was not checked separately (my profile's chip shows the model name).
- Pictures: any `F1-*`.

### F5. Settings tabs at phone width are a one-line strip cut mid-word
- Page: the Settings window, every tab, 360 to 412 wide. `div#settings-nav-list` is one sideways-scrolling row of 17 tabs (Profile, Usage, Appearance, My Dear Bunny, Language, Notifications, ...). About three show, the next is cut in half, the rest need a sideways swipe; nothing hints at it. At 844x390 the nav is a column that scrolls (Privacy cut at the foot: fine, but with no scroll hint).
- Picture: `pictures/F5-settings-360x640-dark.png`.

### F6. Landscape (640x360, 740x360, 844x390): the sidebar's foot and the account menu are cut at the bottom
- Page: sidebar open in landscape. The sidebar list scrolls, and the profile row at its foot (account button, Settings) is below the fold: Settings is reached only by scrolling the sidebar. The account menu (Settings, Usage, Language, Command palette, Zoom) is cut at the bottom (the Zoom row is half visible; the zoom buttons are reached by scrolling the menu).
- Pictures: `pictures/F6-sidebar-landscape-640x360-light.png`, `F6-accountmenu-landscape-640x360-light.png`.

### F7. Landscape (360 px high): the chat gets about 170 px
- With the composer, its row and the row under it (about 150 px) and the top bar (about 50 px), a reply is visible in a sliver at 640x360.
- Picture: `pictures/F8-chat-landscape-640x360-dark.png`.

### F8. Targets smaller than 30 px (every size)
- `select#permission-mode`, `select#effort-level`, `button#job-button`, `button#mode-button`, `button#folder-chip`, `button#branch-chip` (26 px high), `button#new-project`, the `Chat | Code` buttons (24 px), the `Get a key` links, and the switches in Settings (checkbox inputs, 13-16 px). The full list is in `automated-grouped-report.md`.

### F9. The remote device's "Chats access" bar costs a line at the top
- Seen at every size for a device at Chats (one line, about 30 px of a 340 px keyboard-open screen). It is part of the page, so it does not cover anything; at 360x340 it leaves the top bar, the chat and the composer (`F9-keyboard-typed-360x340-light.png` shows the keyboard-open layout without the bar).

## Dropped (measured, looked at, not breaks)
- A code block's Copy button under the top bar in landscape: the chat scrolls under the bar.
- A control "partly hidden" in the first frames of the sidebar or the side panel sliding in: the pictures taken a moment later are whole.
- Items wholly outside a scrolling or collapsed parent (reached by scrolling).
- "SIL Open Font License" link in Settings > About (flagged as clipped by its group at every size): not verified by picture, left in the automated list only.

## Same on all four ways in?
Local browser view, a device at Chats, a device at Everything, and the installed web app (emulated) gave the same breaks, F1 to F8. The Everything and Chats devices add only the top line. The installed-app run cannot emulate the safe-area insets, so the bottom-inset padding (`env(safe-area-inset-bottom)` in `.dock`) is UNKNOWN until seen on a phone.
