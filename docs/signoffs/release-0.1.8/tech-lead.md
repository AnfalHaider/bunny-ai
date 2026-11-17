---
piece: release-0.1.8
role: tech-lead
sha: a6afcf5
verdict: PASS
date: 2026-11-17
---

Supersedes e028d3b. Delta is 3 css files (34 added, 8 removed), nothing else. Checked: between 375d368 and a6afcf5, app.css has NO removed line at all (whitespace ignored); the design sources lose exactly four lines, each replaced on purpose (palette-item selector gains .is-active, the two cz-status word colours move to --warn-text and --ok-text, the dark variable line gains the two text colours); the --ok-text and --warn-text variables are defined for light and dark; the W4-9 wait-row rules are restored. build-css on an archive of a6afcf5 reports app.css up to date, so sources and app.css agree; no CR in any of the three. My e028d3b check compared line counts per file and so missed the dropped rules in app.css (sources-only rules were never in the rebuild); a restored-rules check against 375d368 is what finds them. Not run by me: e2e, the gate.
