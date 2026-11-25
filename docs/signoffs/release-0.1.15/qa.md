---
piece: release-0.1.15
role: qa
sha: 80626b03
verdict: PASS
date: 2026-11-25
---

Full walk ran on 2cd562ec, invented profiles only, with the same code: git diff --name-only 2cd562ec 80626b03 shows only docs/ and README.md files (and 7c81da08..80626b03 is the plan, the v0.1.15 notes, the gate evidence and the Chief's sign-off), so the walk stands for 80626b03. All w0115 scripts pass on 2cd562ec after fixes to scripts that assumed old defaults: aflow 20/20, f567 23/23, f8 16/16, pcnotice 8/8, f9 13/13, f10 17/17 through the test transport, rewind 16/16, pctx 13/13 and 3/3, pg 26/26, ia 13/13, pin 4/4, confine 12/12, judge 16/16, trust 11/11, panel 9/9, qaudit 21/21, qsettings 24/24, soverhaul 4/4, walknew 17/17, pagewalk 16/16 (8 widths, light and dark). Report: docs/qa/walk-2cd562ec/report.md on claude/qa-quickask-audit-0115. NOT covered (UNKNOWN): real engine download and sign-in, connector OAuth happy path, real phone address bar and keyboard, real notification and open-at-login, speech, Search this PC on the real Windows index, update download and install, computer-control kind, browser_capture.
