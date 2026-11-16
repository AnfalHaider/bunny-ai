---
piece: k1-kit-0.6.0
role: tech-lead
sha: f45f024
verdict: PASS
date: 2026-11-16
---

Supersedes my 46add98 PASS, for landing. Delta 46add98..f45f024 read: in bin only guard.mjs changed. The shell command cap is now 64 KB (was 256 KB) and a line with more than 2,000 parts (split on semicolon, ampersand, pipe and line breaks, counted before the full parse) is refused before it is read, so the 21,000-command line QA timed at 23 to 31 seconds cannot reach the parser and a hook the host cuts off cannot become a pass; the count is a cheap split of at most 64 KB. Everyday commands stay well under (the note in the code says under 15 KB). Re-run on a scratch checkout of f45f024: test/kit-next-landing.test.js and test/kit-next-k1.test.js together 28 of 28. The rest of my 46add98 review stands unchanged (the non-bin kit files identical to plugin 0.6.0, the landing in a throw-away clone, the whole staged policy.json to be copied, and the conditions: Security's sign-off on this same sha, the owner's yes and kit apply, bootstrap role per worktree). e2e not run by me.
