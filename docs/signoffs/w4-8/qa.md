---
piece: w4-8
role: qa
sha: 5c8c25a
verdict: PASS
date: 2026-11-17
---

W4-8 at 5c8c25a supersedes my PASS at 08d2d0a. Re-run: e2e/w48-walk.mjs 22 of 22 (real quick-ask controller with fake Electron objects, the real bar page, chat and Settings pages: shortcut, new chat, Esc, setting off, busy waits in the message box, tray rule, screenshot only on a click, window-only keys). New: e2e/w48b-bar-walk.mjs 89 of 89, the real bar page in Chromium at the real window size 700 x 300 and at 420 x 300, light and dark. The + menu is fully inside the window and not cut by the page in every state (plain, with a screenshot chip, with 25 lines of text, with a problem message showing, while Opening Bunny shows); its items are not clipped; html and body fill the 300 high window and nothing scrolls. Opening Bunny is the normal text colour (same as the body text), not amber, with a 12 px accent spinner that animates, is hidden from screen readers and stands still with reduce motion on; the message area is a status region; contrast at least 4.5 to 1; one send only (Enter or Send again while opening does not send twice). A real problem (Bunny could not open) is amber (rgb 180 83 9 light, 233 173 82 dark), no spinner, at least 4.5 to 1, Send works again, a retry sends again, typing clears the message. No page errors. NOT RUN: the real Electron window. The Electron binary is not installed on this computer (node_modules/electron has no dist folder and no path file), and downloading it is a download I may not do without the owner; so real transparent frameless drawing, real focus and the operating system delivering the shortcut stay UNKNOWN, as at 08d2d0a.
