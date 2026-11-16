---
piece: w6-2
role: security
sha: 643c7da
verdict: PASS
date: 2026-11-16
---

Stored 0 for steps/minutes now means off (tested). Condition: a stored 0 for autoContinueTokens also reads 0, which disables the token budget (tokenBudget && in chat.js); keep tokens at its minimum, not 0. Reachable only by writing that setting (window-only once W5-7 adds the key).
