---
piece: w5-1-guard
role: qa
sha: 74fe7ba
verdict: PASS
date: 2026-11-16
---

First sign-off from me on this piece. The staged guard suites at 74fe7ba (claude/builder-w5-1): GUARD_STAGED=1 node --test test/guard-next*.test.js test/guard-016-*.test.js ran in a clean worktree: 144 tests, 144 pass, 0 fail, 0 skipped, 266 s. That covers the guard-next suites (shell parsing, hooks, a1, a2, c, d) and the guard-016 suites (blank, chain, config, gh, paths, records, small, w5b), including the new rule that gh auth with --show-token or -t is refused for every role. I also met the QA role guard live all through this session and it did what it is meant to: it refused direct writes to sign-off files (only the bootstrap signoff command writes them), the text of a forced push, the text of a hard reset, and a sign-off piece id that was a variable instead of a plain name (it even refused a draft of this very note while it quoted a hard reset). The full unit suite at 74fe7ba: 635 tests, 626 pass, 1 fail, and the failure is not a guard test: LA-2 regex search across many files stays fast (on a second run the 5,000-file folder test) are wall-clock timing tests that fail on this branch under machine load because it does not carry the CPU-time bounds the integration line has; both pass on other branches and are the W4-1c family. Not exercised: guard behaviour for roles other than QA beyond what the staged suites cover, and a real release path. Gate not run by QA.
