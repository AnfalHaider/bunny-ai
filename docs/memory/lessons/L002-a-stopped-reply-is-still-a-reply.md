---
id: L002
date: 2026-11-12
session: builder
title: A stopped reply is still a reply
triggers: [stream, abort, stop, sse, chat]
files: [src/server/app.js, src/server/chat.js, src/ui/chat.js]
cost: 45m
evidence: 'e2e/features.spec.js "stopping a reply ends the stream" failed until the server kept the partial text; the browser then had to wait for that write before reading the transcript back.'
status: live
---

Pressing Stop closed the connection, and the server threw the reply away: the
client had what had arrived, the transcript had nothing. The fix was for the
server to notice the closed response (`res.on('close')`), abort the provider
request with the same signal, and keep the text it had already sent, marked as
partial.

A second, quieter bug came with it: the browser read the transcript back
immediately after aborting, before the server had written it, and so showed an
empty reply. The client now polls briefly for the answer to appear.

**Why:** cancelling a request is not the same as undoing it. People press Stop
because they want the rest of the answer, not because they want nothing.

**How to apply:** when a stream is cut short, keep what arrived and say that it
was cut short; when the client gives up first, wait for the server's write
before reading state back.
