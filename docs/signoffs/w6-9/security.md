---
piece: w6-9
role: security
sha: e061ce6
verdict: FAIL
date: 2026-11-17
---

file:// containment holds in 15 spellings but W69-1: read_url with a file address skips the rules check (ruled is only for workspace tools); with Deny-read on .env, read_url file:///.../.env returned ENV-SECRET (verified). One-line fix. See docs/security/2026-11-17-w6-13-w6-9-w6-21-review.md
