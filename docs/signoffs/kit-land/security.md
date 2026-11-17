---
piece: kit-land
role: security
sha: 88bbd53
verdict: PASS
date: 2026-11-17
---

Checked against the INSTALLED .bootstrap/bin of a checkout of 88bbd53 (helper BIN confirmed .bootstrap/bin, KIT_NEXT empty): installed bin, githooks and policy equal scripts/kit-next; worktree-escape and outside-repo probes as at 1d3a77c (only nested git init and git worktree repair/prune/move/lock allowed); pre-push exits 1 from the session worktree, the old-history worktree and a planted git dir; K-1 lists identical to 1d3a77c and no worse than 4a0fa01 (files 4, shell 13, link 13, round2 7, dev2 4, push 13: the accepted interpreter, quote and link class); timing: 200 chained git push --all 0.9 s, 200 chained git push origin f cut at 6.2 s and refused; hook-skipping flags and the hooks-path setting in 12 spellings still refused with the old deny_all entries removed (parser rules cover them, prose stays allowed); hooks run from the main checkout and fail closed; kit.json 0.6.0. Test run on the installed kit 186/194: the 8 failures are old-baseline expectations the stricter kit refuses (chief signing for qa, flags in quoted prose, the pre-landing policy check): refusals, not holes. Residual and accepted: nested git init, worktree repair/prune/move/lock, CLAUDE_PROJECT_DIR unset in a nested repo.
