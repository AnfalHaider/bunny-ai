---
piece: roles
role: tech-lead
sha: b57b606
verdict: PASS
date: 2026-11-17
---

chat.js mergeSameRole on both request bodies (chat.js:119, used by the roomier and refusal retries, and the final-answer round :266); every model call goes through streamChat. Five criteria met: only plain user+user / assistant+assistant merge; tool and tool_calls messages untouched; strings joined by a blank line, parts kept in order with pictures; system never merged; input not mutated so the saved chat is unchanged. Run alone at 88b6082 (contains b57b606): node --test test/roles.test.js: 6 tests, 6 pass, 0 fail. Note: a merge keeps the first message's extra fields only (none used today).
