---
piece: w6-14
role: qa
sha: e7b664a
verdict: PASS
date: 2026-11-17
---

W6-14 with W614-1, checked at 821de5d, which contains e7b664a, invented profile. Card never cut: create_tool, a local connector and run_command over 2,000 characters are refused with a plain message and no card, even in Manual; exactly 2,000 asks; 2,001 is refused; 1,900 shows in full; a long file body is cut on the card with the note 1000 more characters are not shown here. First start: the connector needs the confirmation flag; a 4 s start shows Starting name (first start can take a few minutes) with the seconds counting, finishes and the reply completes; secret and long log lines and colour codes do not reach the stream; removing the connector ends the program and the helper it started (both pids dead). A key passed through the chat is not taken. Walk rows E1-E7 and G1-G7, 40 of 40 in the whole walk. Not run: the full 5 minute first start (only the 4 s one); only the constant FIRST_START_MS = 5 min was read.
