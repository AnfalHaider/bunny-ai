---
piece: la-4b
role: qa
sha: 821de5d
verdict: PASS
date: 2026-11-17
---

LA-4b at 821de5d, invented profile. A runaway regex (a+)+$ over a 45-letter line is stopped and the tool result reads: Search stopped after 5 s; narrow the folder or the pattern. The old too-slow wording is gone; the step is failed, the reply finishes; a fine regex over the same folder finishes with matches and no stop message. Unit tests: test/free-tags and workspace-search 51/51; full unit run 763 tests 0 fail. Wording note, not blocking: one file hits its own 1 s limit, so the reply stopped after about 1 s while the message says 5 s. Walk: e2e/w6-la4b-w33-walk.mjs rows F1-F5.
