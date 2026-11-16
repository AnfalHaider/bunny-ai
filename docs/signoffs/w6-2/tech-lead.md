---
piece: w6-2
role: tech-lead
sha: ea067ae
verdict: PASS
date: 2026-11-16
---

Re-review of 5195551..ea067ae. Caps are clamped on the server whatever Settings holds (steps 1 to 2000, minutes 1 to 600, token budget 100,000 to 100,000,000), a scheduled run gets less (100 steps, 30 minutes, 2,000,000 tokens) and cannot be asked. The loop check works: an estimate of the input tokens sent so far, the same call three times in a row, or 25 rounds with no new call, stops and asks in a card that waits (Keep going or Stop here); anything but Keep going ends the work, and the counters reset on yes, so each extension needs a person. Steps and time caps still bind, Stop is checked before any extension or question. The Settings screen has the three fields. Note: a program holding the page token can still raise the caps to the maximum, and setting 0 steps now means the default, not off. e2e not run by me.
