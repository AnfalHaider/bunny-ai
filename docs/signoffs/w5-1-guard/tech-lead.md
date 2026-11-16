---
piece: w5-1-guard
role: tech-lead
sha: 74fe7ba
verdict: PASS
date: 2026-11-16
---

Delta 900a470..74fe7ba: gh auth with --show-token (also --show-token=true) or a short -t (alone or in a bundle such as -ht, quoted or not) is refused for every role, live pushers included. Probed with the staged guard as builder, release-ops and chief-of-staff: all token-printing forms denied, also behind -R; gh auth status, -h and --hostname still allowed; gh auth token is denied for builder (allowlist). gh has no abbreviated long flags, so exact matching is right. Tests guard-016-gh and guard-016-w5b: 27 pass, 0 fail. This is the one condition of my 900a470 FAIL; the rest of that review (live branch case, symbolic-ref, worktree add -B, download targets, pre-push tag rule, lock-out matrix for ten roles) stands. Not blocking: gh auth token is still allowed for the live pushers (it prints the token); refuse it for them too. Landing: after it lands run bootstrap role <id> in each worktree. e2e not run by me.
