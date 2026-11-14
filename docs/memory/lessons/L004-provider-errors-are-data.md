---
id: L004
date: 2026-11-14
session: builder
title: A provider's error body is data, not noise
triggers: [provider, 404, probe, retry, nvidia, openrouter, google, stream, stall]
files: [src/server/chat.js, src/providers/connections.js, src/providers/discovery.js, src/providers/catalog.js, src/server/unavailable.js]
cost: 3h
evidence: 'scratch probes against the live providers showed 404 "not found for account", 402 "can only afford 1599", Google 404-anonymous/400-bad-key; after the fixes Nvidia and OpenRouter streamed real replies with the owner keys, 219/219 unit and 62/62 browser tests pass.'
status: live
---

**What happened.** Nvidia, OpenRouter and Google keys were connected and yet
every chat failed. The app's own error said only "the provider answered 404".
The real reasons — a model not reachable for the account, a request larger than
the balance covers, an API that lives under a different path — were all in the
response bodies we were discarding.

**The rule.** When an upstream service refuses, read its body and carry its
words to the person. "The provider answered 404" is a diagnostic for us; "the
model has reached its end of life" is an instruction for the person.

**Corollaries**

- Retry only what a retry can fix. OpenRouter names the affordable token count
  in its refusal; Nvidia provisions a model after the first 404. Both get
  exactly one more attempt. Everything else fails loudly.
- A provider's model list can lie about reachability. Nvidia publishes 83 ids
  and serves a subset per account; mark what fails so the picker stops
  offering it.
- A provider that accepts a request and never streams needs a deadline, or the
  person stares at a spinner forever.
- Probes that ask anonymously can get answers that mean nothing (Google: 404
  without a key). When the anonymous call is inconclusive and a key is in
  hand, test the key before claiming a connection.
