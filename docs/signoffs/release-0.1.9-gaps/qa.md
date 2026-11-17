---
piece: release-0.1.9-gaps
role: qa
sha: 8b49c55
verdict: PASS
date: 2026-11-17
---

Post-release gap walk of the published v0.1.9 (tag 8b49c55), invented profiles only, nothing installed, installer not downloaded. e2e/w019-published.mjs 14/14: latest release v0.1.9 published, assets 122,320,093 / 128,637 / 345 bytes; latest.yml version 0.1.9, file name, size equals the installer, one sha512 value twice (88 characters); the updater's reader parses it; the real updater set as 0.1.8 is offered 0.1.9 and refuses a body that does not match the checksum, 0.1.9 and newer are told they have the latest. Published notes match the repo notes line for line. The full gap list (left out: K-5, W2-9, W6-11, RUN to confirm; LOWs; 14 QA findings, none blocking) is in docs/plans/2026-11-18-qa-review-v0.1.9.md. Not covered: the sha512 of the real 122 MB installer against latest.yml (needs the download), a real installed 0.1.8 updating, the real hotkey and bar window.
