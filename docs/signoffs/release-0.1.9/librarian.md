---
piece: release-0.1.9
role: librarian
sha: 9d5167a
verdict: FAIL
date: 2026-11-17
---

Checked the notes text at 8d38c12 (docs only, one file, +55) against code at 9d5167a. Verified: plugin and skill lines (appTools.js:127,185,200,233,234,248; mcp.js:367; app.js:2095; customize.html:202,262); quick-ask limits and checks (quick-ask-logic.js:6,8,9,100-113); GitHub install (appTools.js:13; toolInstall.js:5-8,23); browser views (browserViews.js:4,17,85,109; browserAgent.js; capture.js; app.js:2188); thinking list (providers/thinking.js); task list and picture-job and waiting lines (app.js:1919-1931,2140-2186; model-abilities.js:104); safety lines (download and ownAddress per 504c388; app.js:96,131-155; 591bf83); updates (electron/updater.js; settings.html:603); installer name (package.json version 0.1.9, artifactName Bunny-AI-Setup-${version}.${ext}). FAIL reason: the notes say the app runs on 'Windows 10 and 11, 64-bit'. No code or config at 9d5167a states Windows 10 or 11 support (grep of package.json, electron/, settings.html found none). Fix: cite the source for that claim, or remove the parenthesis. Layout and polish lines rest on the L-1 and POLISH sign-offs (cited, not re-checked). Gate result not yet seen.
