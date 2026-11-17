---
piece: w6-6
role: tech-lead
sha: d0432b1
verdict: PASS
date: 2026-11-17
---

Supersedes FAIL at e28bf5a. d0432b1 (claude/builder-b-w66, after 7b051ce) closes the required item: the clone's .npmrc, .yarnrc, .yarnrc.yml and .pnpmfile.cjs are deleted (non-recursive, so a link is removed as a link) after the HEAD check and before npm, npm gets --registry=https://registry.npmjs.org/, and the card says so. A .npmrc that cannot be deleted (a folder) makes npm fail, not run with it. Notes closed: POST /api/mcp drops body.source; a folder in use gives 409 tool.inUse in plain words after 3 tries. Also: repository-controlled card text (branch, version, push date, program name) is checked against strict one-line patterns (7b051ce); the card says the connector is added switched ON; removeTree never follows a link or junction (test with a junction whose target survives); a git dependency with a prepare script does not run it (test). Run alone at d0432b1: node --test test/w6-6-install.test.js: 20 tests, 20 pass, 0 fail, 0 skipped. Not blocking: the failed-install cleanup (toolInstall.js:146) still uses rm recursive; use removeTree there too for one rule. Security's sign-off is still required (HIGH).
