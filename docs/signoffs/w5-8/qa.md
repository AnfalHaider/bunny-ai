---
piece: w5-8
role: qa
sha: 70bd964
verdict: PASS
date: 2026-11-16
---

W5-8 at 70bd964 (claude/builder-a-w5-8), never a real release. e2e/w58-check.mjs imports the script's own checkTarget, gatherGitState and parseArgs and feeds gatherGitState real git in throwaway worktrees: 10 of 10 PASS. A commit that is not origin/main is refused naming both shas (Refusing to release 70bd964: it is not origin/main (dfac0db)); asking for origin/main by its sha is accepted; at origin/main on a clean tree it is allowed; with an uncommitted change to a tracked file it is refused; an untracked new file does not block (by design); a non-commit target, an empty target and a missing origin/main are refused; a failed fetch refuses with could not fetch origin/main instead of trusting a stale ref; an abbreviated sha of 7 characters is accepted as a prefix and 6 is refused; argument parsing takes --dry-run and --target in both spellings and passes the rest to gh. The real command node scripts/release.mjs --dry-run as the QA role stops at Missing dist/Bunny-AI-Setup-<version>.exe, so nothing was published. OBSERVATION: in main() the target and clean-tree check runs AFTER the installer, role and release-record checks, so a --dry-run is only a pre-flight for the branch and dirty-tree rules once the installer is built, the role is release-ops or hotfix and a docs/releases record exists; I did not spoof the role to get past those. Unit tests at 70bd964: 564 pass, 0 fail. Gate not run by QA.
