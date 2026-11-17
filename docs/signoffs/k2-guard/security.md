---
piece: k2-guard
role: security
sha: 1d3a77c
verdict: PASS
date: 2026-11-17
---

Supersedes my FAIL at ec605fd/bec112e: that FAIL was wrong. My timing probe ran the repo's own .bootstrap/bin guard (KIT_NEXT unset), not kit-next. With kit-next at 1d3a77c: 60 and 200 chained git push --all exit 2 in 2.5 s and 1.8 s; 60 and 200 chained git push origin f hit the 6.2 s deadline and are refused with the did-not-finish message. K2-1..4, .git trust anchors, W5-1d, pre-push from three places hold; K-1 lists no worse than 4a0fa01 (shell 13, link 13, round2 7, dev2 4 mismatches, the accepted interpreter/link class). Open and accepted: nested git init, git worktree repair/prune/move/lock allowed; with CLAUDE_PROJECT_DIR unset a nested repo is judged by its own policy (host always sets it).
