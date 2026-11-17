---
piece: w6-14
role: security
sha: e037514
verdict: FAIL
date: 2026-11-17
---

Command list (npx node uvx python python3 docker), one-line normalised spelling, array args only, env refused, confirm card in every mode incl. Auto and under an allow rule all hold (24 spellings probed, 44 tests pass). FAIL W614-1: the card text is cut at 2,000 characters with no marker (app.js:1963) while a proposed connector may carry 40 args of 1,000 characters (mcpStore cleanLocal), so a node -e or python -c argument padded past 2,000 characters runs code the person never saw, in Auto where the card is the only guard. Fix: refuse a proposal whose card text exceeds 2,000 characters, or show every character.
