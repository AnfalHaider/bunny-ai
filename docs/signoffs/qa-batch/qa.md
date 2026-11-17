---
piece: qa-batch
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Candidate head 591bf83 (Security's memory guard for request bodies). e2e/w019-memguard.mjs 7/7 over raw sockets against a real in-process server on the 15 MB photo route: a body DECLARED 40 MB is refused 413 'over 15 MB' at once (before any body); ordinary requests still work; while one large body (over 1 MB) is open a second large body gets 429 'Another large message is being sent; try again in a moment.' and small requests are not blocked; when the holder disconnects (also half way through an upload) the slot is free again (no stuck-busy); a sender that does not stop is cut off at 3 MB of 40 (connection closed). Note: the 'one large body at a time' slot is process-wide, so one slow large upload delays every other large upload (import, photo) until it ends or disconnects.
