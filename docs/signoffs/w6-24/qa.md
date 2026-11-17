---
piece: w6-24
role: qa
sha: 4ca42f6
verdict: PASS
date: 2026-11-17
---

Re-run on the candidate head (795a8a2, which holds 4ca42f6), real Electron 45.3.2, invented folder. Findings a-d from the first stamp are fixed: (b) typing Bunny's own address shows 'This address is Bunny itself, so it is not opened here.' with no view; (c) the three-dot menu is inside the window at 984 px wide (x 736 to 976, was cut off at the edge); (d) Esc closes it and focus returns to its button. Panel walk 18/18 (view follows panel size and window size, hidden under the menu and Settings and back after, address bar real, cookies split, window.open tab, frame-buster loads). My probe with a shown window: all 21 checks pass incl. Security's four (isolated world 1999 separate, download cancelled and nothing written, window.open tab, cookies differ). Open point (a): the new test/probes/views-smoke.cjs now starts, but on this machine its screenshot step still throws UnknownVizError because its window sits at x=-4000,y=-4000 and does not paint; with the window on screen the same step passes. Not a product defect; the probe's own last check fails here.
