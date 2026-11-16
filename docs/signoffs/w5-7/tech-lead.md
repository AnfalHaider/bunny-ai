---
piece: w5-7
role: tech-lead
sha: 2c29444
verdict: PASS
date: 2026-11-16
---

Delta c1b4c18..2c29444: autoUpdate and fallbackWhenBusy move from the ordinary settings to the window-only list (server and page copy), so with only the page token updates cannot be switched off and the busy fallback cannot be changed; a new test checks 403 with the token only and 200 through the window's channel. My key scan of every data-key, data-cap and save() key still finds no setting on neither list; window-only and permission-rules-app tests 29 pass, 0 fail. Settings still writes both keys through the window's own channel, so the screen keeps working in the app. e2e not run by me.
