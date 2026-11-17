---
piece: polish
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Run on the candidate head 591bf83 (holds POLISH 368b984). e2e/w019-polish.mjs 16/16, my own checks (the Builder's tests were not used). Gap 7/8: picker group label 5.75:1 light and 6.38:1 dark, 'Provider' chip label 5.47:1 / 7.17:1, amber switch note 6.52:1 / 8.18:1, measured on the live picker. Gap 9: the line is 'Switched to {model}: no provider has {from} left. {provider} {reason}{more}' with no brackets inside brackets. Gap 10: asksToRunCommands catches 13 hand-off phrasings (incl. all of my missed ones and a choice 'I will run it myself') and does not catch 8 Bunny-asks-about-its-own-run phrasings including 'Would you like me to type the command into the terminal?'. Gap 11: goesThenStops 19 phrasings right ('yes, no problem', 'continue, don't stop' go on; 'continue, stop', 'yes, stop', 'yes, hold on' stop). Gap 12: a schedule_task prompt of exactly 2,000 characters shows one card with the whole prompt, 1,900 too, 2,001 is refused with 'more than 2000 characters'. Gap 13: real workspace and real clock, a pattern one file cannot finish says 'one file took more than a second' (1.0 s). Not re-walked: the 'after 5 s in all' message needs many files each under a second (the 12-file fixture stopped on the first file). Gap 16 (notes wording) is the Chief's.
