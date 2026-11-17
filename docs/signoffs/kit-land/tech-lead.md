---
piece: kit-land
role: tech-lead
sha: 88bbd53
verdict: PASS
date: 2026-11-17
---

Landing commit over 1d3a77c. I checked in a checkout of 88bbd53: .bootstrap/bin, .githooks, .bootstrap/policy.json, flow and ui are byte-identical to scripts/kit-next (diff -rq clean); kit.json 0.6.0; record has the owner's words and question. The 7 failures without KIT_NEXT are tests that expect the OLD guard (they branch on KIT_NEXT/LIVE_STRICT): huge command allowed to docs, flag/prose in quoted text refused, CoS may sign for another role. Each shows the new, designed K-1 behaviour (too-long refused, quoted text is data, nobody signs for another role); the same suites are 149/149 with KIT_NEXT=1 (also my own run on 4a0fa01 and 1d3a77c). Follow-ups: make the suites default to the installed guard and drop the old-guard branches; the 8th (landing test on old policy) is expected to flip. The kit record lists .gitignore@hash though .gitignore was not landed (cosmetic). Not run by me: e2e; the landing itself.
