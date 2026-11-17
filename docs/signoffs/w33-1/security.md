---
piece: w33-1
role: security
sha: 5d7983d
verdict: PASS
date: 2026-11-17
---

Supersedes my W33-1 finding. The schedule card now shows the interval, the may-change note and the whole prompt, the same text the scheduler stores (it trims and keeps 4,000 characters); a card over 2,000 characters is refused, so the person sees all of it. With may_change false the schedule runs in plan mode (read-only) and, in Accept and Auto, no card is shown: a long prompt there is not refused, accepted because it can only look. Tests pass (85).
