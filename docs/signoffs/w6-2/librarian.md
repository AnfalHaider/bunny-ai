---
piece: w6-2
role: librarian
sha: 0bdb7f3
verdict: FAIL
date: 2026-11-16
---

Librarian FAIL until the Token budget help line gives the lowest value. The commit 90dd8fa makes the token cap never 0 and clamps it to a 100,000 minimum in src/server/caps.js. The steps and minutes rows say 0 turns it off; the token row says nothing, so a person who types 0 is silently given 100,000. Add to the desc at src/ui/settings.html line 392: The lowest is 100,000. No Claude credit in the message. Lessons L001 to L008 checked; none is due.
