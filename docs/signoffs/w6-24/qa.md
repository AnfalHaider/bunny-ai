---
piece: w6-24
role: qa
sha: 8f66eb2
verdict: PASS
date: 2026-11-17
---

Real Electron 45.3.2 on an invented userData folder (no OS keys, real profile untouched). Security's four proofs, run in a visible window: (1) executeJavaScriptInIsolatedWorld(1999) is a real separate world: page variable seen in main world, not in 1999; what runs in 1999 is invisible to the page; a page that broke Array.prototype.map still reads fine in 1999, and the model read action works on a tampered page; (2) a download is cancelled, the panel is told (download-blocked) and nothing is written to Downloads; (3) window.open becomes a new tab, no extra window; (4) cookies differ: panel session holds sid, Bunny's page and default session do not. Panel walk (16 rows, 15 pass, the 16th was my own wrong criterion and is a pass by hand): page loads as a view, address bar shows the real address and follows a redirect, cookie kept, frame-busting page loads, Bunny's own port opens no view, the view sits on the panel's content area and follows the window size, the page is hidden while the menu or Settings is open and back after, pictures show the page in the real window. file:, javascript: and data: refused, own port refused in every spelling. Findings, not blocking: (a) the shipped probe hangs under npx electron test/probes/views-smoke.mjs (top-level await in an ESM main) and throws UnknownVizError at its screenshot step when the window is hidden (show:false); I ran it through a CommonJS wrapper with a visible window; (b) typing Bunny's own address opens an empty tab with no message saying why; (c) in a narrow window the three-dot menu is cut off at the window edge; (d) Esc does not close the three-dot menu; (e) a screenshot of a panel view needs a shown window.
