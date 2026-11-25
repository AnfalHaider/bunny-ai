---
piece: s-link-1
role: security
sha: c71d780e
verdict: PASS
date: 2026-11-25
---

S-LINK-1 (HIGH, owner's go) and F4-1. Read: the mustExist:false branch lstats the target and refuses any link, including one that points nowhere; an existing plain file gets realpath, then isProtected, then the inside-the-root check; isProtected is applied to the parent's real path. edit_file and multi_edit already use the must-exist check. Stripe removed from curatedPlugins.js. Ran workspace-links.test.js in an invented profile: 13 pass, 12 skipped (file links need developer mode, EPERM), 3 fail only because the office packages (pptxgenjs) are missing from this worktree's node_modules, not the fix. Probe: a dangling junction as a parent (dj/x.txt, dj/sub/x.txt, dj/a/b/x.txt) is refused at mkdir and nothing is created outside. Open: real file links untested on this PC (run where developer mode is on, expect 28 pass); a dangling-link parent is refused by mkdir rather than by an explicit check (LOW, v0.1.16); hard links not covered (v0.1.16).
