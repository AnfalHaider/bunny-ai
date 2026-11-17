---
piece: w6-20
role: security
sha: 375d368
verdict: PASS
date: 2026-11-17
---

The 12 MB limit is a parameter of that one readBody call (the browser answer route); the default stays 1 MB and the other large reads keep their own explicit limits (15 MB, 300 MB import, 2 MB). The route was not changed in who may call it: it is behind the same request guard as every /api route and resolves only a waiting action id of that session (random UUID known to the window). Too large: the body is read and dropped without being kept (no buffering past the limit), the waiting chat is told at once, the answer is 413; bad JSON is 400. browser-screenshot (5), window-only (16) tests pass. Observation: this route is not in the window-only table, and was not before; it carries page content, not a permission, so a forged answer needs the page token and the pending id.
