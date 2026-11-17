---
piece: w4-12
role: security
sha: f6180e8
verdict: PASS
date: 2026-11-17
---

Supersedes bcca328. The diff from bcca328 is three hunks (app.js, chat.js, e2e): no route, window-only table or card routing touched, so typed text still reaches only question cards and permission and capability cards stay unreachable. The new gone flag only separates 'the person skipped' (shown and saved as Skipped) from 'nobody was there' (a closed or timed-out reply); both still mean no answer, and a background or ended reply still cannot answer. A go-ahead word followed by stop, don't, do not, no, not, wait or hold now stops (checked 8 phrasings); the error direction is a stop, never an extra carry-on. Known and harmless: 'yes and stop after the tests' carries on, with the person's words passed to the model. 35 tests pass.
