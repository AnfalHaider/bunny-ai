---
piece: w2-7-rules
role: tech-lead
sha: 8e42b6a
verdict: FAIL
date: 2026-11-16
---

Delta 47e2312..8e42b6a. Fix 2 of my last review is in and probed: git "push" x, git p'ush' origin, git -C . --no-pager "push", Remove-Item "-Recurse" x and gh --repo a/b "release" create are now denied by their rules; all leading git and gh options are skipped; New-PSDrive, ndr, mount and -PSProvider Alias/Function/Variable are wrappers and ask. The phone wrap is a CSS change (not looked at by me). Still FAIL, one required fix not yet applied: the window-only mode change is bypassable. src/server/app.js and windowOnly.js are unchanged since 47e2312, so a caller holding only the page token can still set permissionMode to auto through POST /api/sessions and through PATCH /api/sessions/:id with a permissionMode body (I got 200 and auto for both in desktop mode). Fix: treat permissionMode in those two bodies as window-only (403 without the admin secret) and add token-only tests for both. e2e not run by me.
