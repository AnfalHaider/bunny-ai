---
piece: k1-kit-0.6.0
role: tech-lead
sha: 9538bcb
verdict: PASS
date: 2026-11-16
---

Supersedes my 714a0a8 PASS. Delta 714a0a8..9538bcb read against the code and re-run on a scratch checkout of 9538bcb: test/kit-next-k1.test.js 24 of 24; the guard suites (guard-next, guard-providers, guard-016) with KIT_NEXT=1 149 of 149. Delta: the push destination heads/main is now read as the live branch in all three places (guard.mjs pushTargets, shellrules pushDestinations, shellextra label move); I re-probed with the staged guard as a builder: push origin HEAD:heads/main, refs/heads/main and main are all refused, and HEAD:MAIN and refs/heads/Main (other branches on the case-sensitive remote) still pass. Ids: isPlainId in policy.mjs (letters, digits, dot, dash, underscore; no .., no trailing dot or space, no Windows reserved device name) is used by the CLI plainId, by bootstrap role itself (the brief is always .bootstrap/roles/<id>.md) and by the shell rule okId. Project lookup: guard.mjs takes the project from CLAUDE_PROJECT_DIR if its policy exists and the repository is inside it, else the nearest policy above where the hook runs, and only last above the cwd the agent named, so a policy planted in a nested repository does not win; the hook's own environment is not settable from a command. Fetch: git's default refspec (+refs/heads/*:refs/remotes/origin/*) and a destination under remotes/ are allowed; destinations onto a branch label, any glob, or tags, and --refmap and --stdin (including unique abbreviations), are refused (probed). The conditions of my earlier K-1 reviews stand (Security's sign-off on this same sha, the owner's yes and kit apply, run bootstrap role per worktree after landing, flow, ui, kit.json and .gitignore ride on a kit record). e2e not run by me.
