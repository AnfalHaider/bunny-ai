---
piece: kit-land
role: security
sha: da999b0
verdict: PASS
date: 2026-11-17
---

Supersedes my PASS at ba091a6. da999b0 differs from ba091a6 only in four test files (git diff of .bootstrap and .githooks is empty), so my installed-files probe results at ba091a6 stand. No assertion about the new guard was weakened: NEW_KIT is true when KIT_NEXT is set or when the live guard.mjs and lib/policy.mjs equal the staged ones, and then the strict expectations apply (the over-256 KB refusal, nobody signs for another role, the live policy equals the staged one with both record folders); the old expectations apply only to a live guard that is not kit-next, and a mismatch there fails safe. LIVE_STRICT is off only for the installed 0.6.0 kit, which reads words, as kit-next does. The landing test now also requires the live policy to equal the staged one. Run one file at a time on this loaded machine: guard-next-a2 15/15, guard-next-c 13/13, kit-next-landing 3/3, installed and with KIT_NEXT=1 (a parallel run of all guard and kit files timed out under load).
