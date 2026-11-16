---
piece: d1
role: qa
sha: 2cfeec5
verdict: FAIL
date: 2026-11-16
---

Gate at 2cfeec5: 7 of 7 (92 e2e). Walk e2e/q2-d1-walk.mjs on an invented profile, desktop 1440 and phone 390, light and dark: 22 of 24. PASS: Add a provider button on the empty greeting opens Providers; custom provider form comes before Popular providers; phone Automation Add buttons are full width; the hopping bunny face is the accent token (6a4fd8 light, b3a1ff dark), normal and grumpy; no console errors. FAIL (Q2-28): the phone Settings pill row shows one pill at a time: each pill is 364 px wide on a 390 px phone because .nav-row width 100 percent at src/ui/app.css:259 is not overridden by the phone rule (needs width auto), so 14 of 15 sections are off screen; the Builder own screenshot docs/design/review-0.1.4/built/settings-light-m.png shows the same. Everything else in D1 is fine; re-sign PASS on the release sha once Q2-28 is fixed.
