---
piece: w4-8b
role: qa
sha: 3cb6368
verdict: PASS
date: 2026-11-17
---

e2e/w019-w48b-file.mjs 37/39 with a stand-in Electron and dialog, invented files, the real bar page and chat page (real Electron file dialog NOT run: needs OS keys). Security items all hold: id-only submit, page cannot smuggle bytes or path, secret names/contents refused, bytes must match the name, UNC/device paths refused without touching disk, grow-while-reading refused, one pick at a time, replay refused, drop/close forgets. Findings (non-security): (1) a text file over about 128 KB is refused as 'holds a key or password' (the secret check fails closed above 128 KB) although the bar says up to 8 MB; (2) a picture or PDF over 1 MB passes the bar, the bar closes, and the new chat then says 'That is too large (over 1 MB)' (chat request limit).
