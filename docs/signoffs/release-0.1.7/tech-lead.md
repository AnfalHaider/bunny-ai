---
piece: release-0.1.7
role: tech-lead
sha: bf83b01
verdict: PASS
date: 2026-11-16
---

Reading only (quiet window: no test or build run by me). Delta 909a439..bf83b01 is two files. src/ui/token.js, 3 lines: the call remembers the token it went out with; if its 403 request.noToken arrives and the page token has meanwhile been replaced by a parallel call's refresh, it is sent once more with the new token, without asking the server again. It cannot loop (the resend's answer is returned as it is, as before), the token still comes only from the page's own meta tag on its own origin, and the refresh path (changed, same, unreachable) is untouched. A Request body is read from the clone made before the first send, so the resend has its body. e2e/request-guard.spec.js is test-only (start-up calls and the service worker no longer race the token tests). The rest of the candidate is as in my 909a439 review. Before release: the gate on exactly this sha, dist built from it, the release record, and bootstrap role <id> per worktree after landing. e2e not run by me.
