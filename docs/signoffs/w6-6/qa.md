---
piece: w6-6
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Walked on the candidate head 591bf83 (which holds e28bf5a plus Security's later changes to toolInstall.js and appTools.js). e2e/w019-w66.mjs 25/25 with the REAL installer (real git clone from a LOCAL repository, real npm) in the real app on an invented folder; the GitHub answers come from a local fake that refuses any other host. Card in ask, accept-edits and auto (one card each): repository, stars, exact commit, install folder inside <data>\tools, npm ci --ignore-scripts with the registry, the settings-files note, the start command, switched ON, 'runs code from the internet'. A no installs nothing (no folder, no connector). A yes installs exactly the card's commit, the repository's own preinstall/postinstall did NOT run (marker file absent), its .npmrc was deleted, the connector is local, ON, with source, and its tool answers '7 carrots' in a later chat. Same commit twice refused; a moved branch installs nothing; a private repository is refused with no card; Plan mode refuses with no card (the tool is not even offered); deleting the connector removes its folder; a saved folder of '..' is refused (400) and removes nothing. Not covered: real GitHub and the real npm registry (never the network; the repo has no dependencies so npm had nothing to fetch).
