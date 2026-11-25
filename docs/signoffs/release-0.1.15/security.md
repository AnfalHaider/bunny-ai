---
piece: release-0.1.15
role: security
sha: 80626b03
verdict: PASS
date: 2026-11-25
---

Moved from 7c81da08 (my PASS there stands). 80626b03 is the merge of integration 7c81da08 into main (parents a2877e09 and 7c81da08). Checked: git diff 7c81da08 80626b03 outside docs/ is empty, so the shipped code is exactly what I passed at 7c81da08 and 2cd562ec; the only differences are under docs/ (the v0.1.15 plan, notes, gate evidence and the Chief of Staff's sign-off). Gate on 80626b03 is being run by Builder A, not by me. Follow-ups unchanged: G2-1 HIGH; IA-7b MEDIUM; README Auto-trust sentence overstates the check (LOW, docs); hard links; a link pointing nowhere used as a parent refused by mkdir (LOW); real file links untested without developer mode; earlier LOWs.
