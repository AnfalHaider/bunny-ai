---
piece: run
role: tech-lead
sha: 0f0e5a4
verdict: PASS
date: 2026-11-17
---

Read scripts/unit-tests.mjs and the package.json change (651ef6c..0f0e5a4). --list at 0f0e5a4: 78 parallel + 18 guard/kit = 96, equal to every test/*.test.js. Nothing skipped: no non-.test.js file under test/ imports node:test, no nested test files, and no other test file references .bootstrap or CLAUDE_PROJECT_DIR. Probe in a scratch copy with CLAUDE_PROJECT_DIR=X: parallel step sees X, guard step sees it unset, a failing kit test makes the run exit 1, a never-exiting helper in test/probes is not run. Hang stop (4 min silent) read, not exercised. Note, not blocking: on Windows child.kill on a hang kills the runner only, not its per-file children.
