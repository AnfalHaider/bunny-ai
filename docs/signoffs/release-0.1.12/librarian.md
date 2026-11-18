---
piece: release-0.1.12
role: librarian
sha: eba5478
verdict: PASS
date: 2026-11-18
---

Librarian: PASS at eba5478. Notes checked against the candidate: package.json 0.1.12; installer line names Bunny-AI-Setup-0.1.12.exe (64-bit). Web-app claims checked in source: Install as an app (settings.html, install-app.js); Bunny is not running (browser-mode.js); Update ready · Reload (chat.js, install-app.js); cache rule keeps only static files and refuses pages, /api, query strings and set-cookie (bunny-sw.js mayCache); viewport-fit and safe-area CSS; theme-color and manifest colours; apple-mobile-web-app-capable. Line 12 uses the background-clear wording, matching electron/clear-old-workers.js at eba5478 (background, 3 s, retry on the next start) and the browser-side unregister at chat.js. Gate: Librarian read the gate output for eba5478 in the main checkout's evidence folder: 9 checks, each PASS; unit 198/198; e2e 315 passed; last line GATE PASSED 9/9.
