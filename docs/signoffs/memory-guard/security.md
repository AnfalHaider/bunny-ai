---
piece: memory-guard
role: security
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

413 on declared size before reading; one >1 MB body app-wide, 429 for a second, slot released on end/close/error/too-big; cut at 2x cap; 3/3 + message-body-size 1/1. LOW: a slow sender keeps the slot up to Node's default requestTimeout (300 s); fine for a local app, could set server.requestTimeout lower for the message route later.
