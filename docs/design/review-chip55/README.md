# Phone chip at up to 55vw: build c1c0e8d

Design, 2026-11-18. Verdict: **FAIL on phones narrower than about 400 px** (read from the page on an invented profile).

At 390 px the chip (109 to 324) overlaps the Send button (323 to 358) by 1 px; at 360 px by 9 px (chip right 304, Send left 295); at 320 px by 21 px (chip right 278, Send left 257); the Send button also shrinks. At 600 px it is fine (chip 38 to 44 percent). The chip is 55vw wide but the row also needs room for + (33), the mic (33), Send (35), the composer padding and the gaps, about 180 px, so 55vw is too wide below about 400 px. Fix: max-width of min(55vw, calc(100vw - 190px)), min-width 0 and flex-shrink 1 so the chip shrinks first; the 390 px chip then is about 200 px wide, the 320 px chip about 130 px. Pictures: 390x780 and 320x640 in this folder; readings in log.txt.

## Re-check at 28812e1: PASS
Chip is now min(55vw, 100vw - 190px), shrinkable. Measured at 390, 360 and 320 px, light and dark, Auto and hand-picked (12 readings in log.txt): the chip ends 4 px before Send every time (chip 118 to 318 at 390, 118 to 288 at 360, 118 to 248 at 320; Send 36 px wide and inside the composer), 15 px after the mic, no sideways scroll. The name stays readable ("Auto · NVIDIA: Nemotron 3 Ultra (free)" with the ellipsis at the end). Pictures: fix-*.png.
