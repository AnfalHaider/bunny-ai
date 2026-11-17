---
piece: kit-land
role: security
sha: ba091a6
verdict: PASS
date: 2026-11-17
---

Supersedes my FAIL at 88bbd53. Probed against the INSTALLED .bootstrap/bin of a checkout of ba091a6 (equals scripts/kit-next; KIT_NEXT empty). Item 1 closed: node -e, python -c, echo piped to sh and xargs with the hook-skip flag or the hooks-path setting are refused (14 spellings, prose still allowed). Item 2: bootstrap flow and flow-ui.mjs refused for every role but the Chief (a saved flow.json still widens a role if something writes it, but only the Chief can run the editor and tools and redirects are refused; the guard still reads the working-tree flow: accepted residual). Item 3: flow-changes and kit-changes records are Chief-only at commit and push (recordChecks). Item 4: an unassigned session may take a working role only; chief-of-staff and release-ops refused. Unchanged from 88bbd53 and accepted: worktree-escape and outside-repo probes (only nested git init, git init elsewhere and worktree repair/prune/move/lock allowed), pre-push exit 1 from three places, K-1 lists identical (4/13/13/7/4/13), 200 chained push --all in 1.0 s and 200 chained push origin f cut at 6.1 s and refused, CLAUDE_PROJECT_DIR unset in a nested repo.
