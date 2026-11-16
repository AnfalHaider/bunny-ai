---
piece: w5-8
role: qa
sha: 349061d
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 70bd964. Never a real release. At 349061d the dry run runs the git and build checks first and lists every failing check at once. e2e/w58b-check.mjs imports the script's own functions and feeds gatherGitState real git in throwaway worktrees: 10 of 10 PASS. A non-main commit is refused naming both shas; origin/main clean with HEAD as the target is allowed; an UNTRACKED file and an edited tracked file are each refused (the status check now counts untracked files); a target that is origin/main while another commit is checked out is refused (dist/ is built from the folder); dist/build-sha.txt must equal the target (missing, another sha and a dirty-build marker are refused); only --notes-file goes on to gh (--draft, --repo, --prerelease, --latest=false and a bare --notes-file are refused). The real command node scripts/release.mjs --dry-run as a non-release session on a non-main commit printed a role note (not needed for a dry run) and then 5 problems at once (not origin/main, build-sha.txt missing, three missing installer files), exit 1, nothing published. OBSERVATION: within the git checks the first failing rule wins, so on a non-main commit with an untracked file the dry run lists the not-main problem but not the untracked file; the untracked file is reported once the commit is origin/main. Unit tests at 349061d: 571 pass, 0 fail. Gate not run by QA.
