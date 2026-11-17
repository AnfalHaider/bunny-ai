---
piece: roles
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Candidate head 591bf83 (holds b57b606). e2e/w019-roles-p41.mjs R1 to R5 on a real server with a scripted upstream: three user messages in a row (two never answered) go out as ONE user message joined with blank lines in order; the saved chat still has three separate messages; a tool turn keeps its shape (assistant tool_calls, tool, tool_call_id intact); an earlier message with a picture and a plain one merge into one user message with exactly one image part and both texts; no user/user or assistant/assistant pairs in any outgoing request.
