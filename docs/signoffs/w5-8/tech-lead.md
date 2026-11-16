---
piece: w5-8
role: tech-lead
sha: 70bd964
verdict: PASS
date: 2026-11-16
---

Reviewed release.mjs and test/release-target.test.js. The release is refused unless the resolved target is exactly origin/main (fetched first; a fetch failure, a missing origin/main, an unresolvable target or a tracked change in the tree each refuse), the tag is created with --target <that full sha>, and --dry-run prints the plan and publishes nothing. The role and release-record checks are kept as they were. Before this the tag followed GitHub's default branch (initial-import), which is the real fault it fixes. Tests (11, the logic with a fake git) pass. Not blocking: the built files in dist are not tied to the sha (only the version in latest.yml is checked), so an installer built earlier from another tree with the same version number would be uploaded under the right tag; have the build write the sha into dist and have release.mjs compare it. Untracked files are ignored by the clean check. e2e not run by me.
