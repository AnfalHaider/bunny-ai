---
piece: release-0.1.5
role: security
sha: 2892fa4
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at e94f224. Code since then is only the Plan mode rule (edit run build send plus move_to_new_chat by name); read the diff and ran the plan mode, permission mode, request guard and pane tests on this sha: 62 of 62 pass. Plan mode refuses browser click and type and write_file and move_to_new_chat, still asks questions and makes artifacts. Earlier checks at e94f224 stand: request guard attacks refused, folder gate wired in the desktop app with typed folders refused on chats projects and schedules, drive root and data folder refused. Known and not blocking: G1-1 gh release and pr merge unguarded, G1-2 records unchecked at commit, Auto mode asks nothing for new tools schedules and local connectors (owner decision), landed guard blocks commit messages that mention the skip flag. Not tested: a packaged run, real Google sign-in, a real provider key, e2e (held back for QA).
