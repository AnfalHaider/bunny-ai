---
piece: w2-7-rules
role: security
sha: 47e2312
verdict: PASS
date: 2026-11-16
---

W27-1 HIGH closed (probe.mjs and probe2.mjs: no bypass; 37 more Allow spellings: none). W27-3 closed for rules and default mode (403 with token only). Conditions: W27c-1 session/schedule create+patch and permission-answer still token-only; W27c-2 git quoted subcommand dodges Deny; W27c-3 gh/git global options. See docs/security/2026-11-16-w2-7c-recheck.md
