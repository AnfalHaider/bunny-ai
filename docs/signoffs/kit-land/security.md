---
piece: kit-land
role: security
sha: 88bbd53
verdict: FAIL
date: 2026-11-17
---

Supersedes my PASS at 88bbd53. The automated reviewer's item 1 is CONFIRMED and is a regression against 4a0fa01: with the hook-skip patterns moved to legacy_deny_all (run only for unreadable or ANSI-C commands), a hook-skipping git commit or a hooks-path change is ALLOWED inside node -e, python -c, echo ... piped to sh, and xargs (refused at 4a0fa01); the skip turns off pre-commit and pre-push, the backstops. My earlier 12-spelling probe used plain git and bash -c only. Items 2 to 5 answered with lower severity in docs/security/2026-11-17-kit-land-88bbd53-review.md.
