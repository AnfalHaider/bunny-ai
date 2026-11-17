---
piece: w4-9
role: qa
sha: 06b9d8c
verdict: PASS
date: 2026-11-17
---

W4-9 at 06b9d8c (Builder A branch; the setting itself is NOT on the W6 line 5d7983d, only its test fix 9209d78 is). Invented profile. Settings API: 15, 30, 60, 90, 120, 10, 600 and 45 accepted and read back; 9, 601, 0, -5, 30.5, abc, the text 30, null, true, list, object, 1e9 and NaN refused with 400 and Use a whole number of seconds from 10 to 600. Not saved. and nothing saved, also when sent together with another setting; survives a restart; a hand-damaged settings.json value (text, too big, too small, fraction, null) does not crash and 30 applies. Limit table: default 30/60/60 s, 15 gives 15/30, 300 gives 300/600, 400 and 600 capped at 600. Real timing against a server that never answers: wait 10 gives up after 10.0 s, 20 after 20.0 s, none set 30.0 s, reasoning model at 10 after 20.0 s, a reply that starts then goes silent after 20.0 s keeping the first words; through the real chat route with the wait saved as 10 the reply ends after 10.07 s with a chat.stalled error event. Settings page in Chromium at 1280 and 390 px, light and dark: choices, Custom box, bad values and the not-saved note (contrast ok), 600 note, reload keeps Custom 45, row dims with the fallback switch off, no sideways scroll, no page error. Walks e2e/w49-walk.mjs 47 of 47 and e2e/w49-ui-walk.mjs 79 of 79. Robustness note, not blocking: if the choice of a preset is made while the number box still has focus (a script, not a person's click) the box blur can save the old custom value back, leaving the select on 15 while the note and the stored value say 45; a click moves focus first, so I could not make a person hit it. The CPU-time clock test change in test/workspace-search.test.js is sound (51 of 51).
