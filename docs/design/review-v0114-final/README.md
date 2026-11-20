# Design check of v0.1.14 at 5fbb797 (claude/v0114-integration), invented profile, both themes, phone and desktop

PASS against the approved drawings: Quick ask bar (same as v0.1.13), one-row connector/skill/plugin lists (210 px for four connectors, switch on the row, menu), Engines rows (53 px, switch inline, recommended dot, Use Bunny's engine confirm), the devices chip and its events (state words, "New: ... signed in", Everything with a count, click panel, no #remote-note/#device-note, red Everything chip on a device page, nothing at Chats), the phone top bar (360: menu + title + chip + more; 390/412: + Session overview; 720: Export + three icons + more) and its sheet.

NOT signed: the Engines page with "Use Bunny's engine" turned off.
1. The ER-6 warning is unreadable in dark mode (pale text on a cream box), desktop and phone (engines/rules-off-d-dark.png, rules-off-m-dark.png). Light mode is readable.
2. The rules editor is three narrow centred text boxes (Allow, Ask, Deny); the drawing has Deny/Ask/Allow lists with an add-rule line and the locked floor rows.
3. "Use Bunny's engine" is a separate settings row below "Engine for new chats", not the first one-line row of the list as drawn (minor).
Scripts: check-engine-rules.cjs, check-topbar.cjs, ../review-v0113-final/scripts/check-bar.cjs, ../review-v0114-tight-rows/check-rows.cjs, ../review-v0114-engines/check-engines.cjs.
