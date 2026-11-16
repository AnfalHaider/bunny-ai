---
piece: release-0.1.7
role: qa
sha: 6b06ed9
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 91b659f and closes the caveat I raised there. 6b06ed9 is 91b659f plus one change in scripts/build-css.mjs (git diff 91b659f 6b06ed9 shows that file only): build:css now builds with LF, compares with the file on disk ignoring line endings, leaves it alone when only the endings differ, and when the content really changed writes it with the existing file's own endings. CHECKS on a fresh worktree at 6b06ed9 with core.autocrlf=true (this machine): the checkout's app.css is CRLF (2063 CR bytes), git status --porcelain is empty; npm run build:css's script says src/ui/app.css is up to date (not rewritten), the file is byte-for-byte unchanged, and git status --porcelain is STILL EMPTY; release.mjs gatherGitState reports dirty = false right after build:css (it was true at 91b659f). The app's look is unchanged: app.css has the same content as at bf83b01 ignoring line endings (same hash), and the committed blob is identical to the one at 91b659f. When the content does change (I appended a rule to the bindings file in a scratch checkout) the rebuilt app.css contains the new rule and keeps CRLF; restoring it leaves the tree clean. A checkout with core.autocrlf=false (LF) also stays clean after build:css. Unit tests at 6b06ed9: 742 tests, 734 pass, 0 fail, 8 todo, 90 s (the CSS-related test/api.test.js is in that run). Not done: npm run dist or electron-builder (the publish block, --publish never and latest.yml are read only), a full gate, e2e, Electron, a real release.
