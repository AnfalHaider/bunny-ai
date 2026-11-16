---
piece: w5-7
role: tech-lead
sha: c1b4c18
verdict: PASS
date: 2026-11-16
---

Re-review of 400946b..c1b4c18. My required fix is in: chartsEnabled, fallbackWhenBusy, statusLabels, transcriptView, promptSuggestions and autoUpdate are now known settings, and a test reads every key the screens write and fails on one that is on neither list. I re-ran my own scans of data-key, data-cap and static save() keys on this sha: no unknown key left. Unit tests window-only and permission-rules: 39 pass, 0 fail. Everything else of the 400946b review stands (window-only caps and helpers, question cards, computed arguments ask). e2e not run by me.
