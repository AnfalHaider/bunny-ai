---
piece: release-0.1.7
role: tech-lead
sha: 909a439
verdict: PASS
date: 2026-11-16
---

Reading only (quiet window): no test or build run by me on this sha. The candidate is dfac0db plus five merges of tips I signed (W5-7 2c29444, Builder B's batch 1d8f6ec, W4-5c bac4ae5, W5-8 349061d, guard 74fe7ba), the version bump to 0.1.7 (package.json and the lock file) and one help-text commit; I listed the non-merge commits not reachable from the five tips and dfac0db: only those two. No conflict markers left in the tree. The one hand-resolved conflict, app.js before streamChat, keeps both sides: replyStartedAt, replyCaps from caps.js and permissionNudges (Builder B) beside thinkingMs, thinkingSince and closeThinking (Builder A); closeThinking is declared before the stream starts and runTool only calls it during the stream, so there is no early use; the streamChat options keep extendRounds, tokenBudget, onLimit (its closing brace is there), onReplyEnd and onThinking with the thinking timer; closeThinking runs before each delta is added. The window-only settings list and route table in server and page are textually equal. The help text now names automatic updates and the busy fallback as window-only. The unit suite and the end-to-end suite belong to the gate; I did not see them. Before release: the gate on exactly this sha, dist built from it (npm run dist stamps it), the release record, and after landing bootstrap role <id> in each worktree. e2e not run by me.
