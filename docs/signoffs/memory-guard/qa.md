---
piece: memory-guard
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Security's memory guard for request bodies, walked on the candidate (591bf83). e2e/w019-memguard.mjs 7/7 over raw sockets, real in-process server, 15 MB photo route: a body DECLARED 40 MB is refused 413 at once; small requests keep working; while one large body (over 1 MB) is open a second large body gets 429 'Another large message is being sent; try again in a moment.' and small requests are not blocked; the slot frees when the holder disconnects, also half way through an upload; a sender that does not stop is cut off at 3 MB of 40. Note: the slot is app-wide.
