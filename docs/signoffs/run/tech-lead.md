---
piece: run
role: tech-lead
sha: 29aba58
verdict: PASS
date: 2026-11-17
---

Supersedes my PASS at 0f0e5a4. 29aba58 (claude/builder-b-run) is on main 4995d5f; against main it changes only the npm test line (node --test test/ -> node scripts/unit-tests.mjs) and adds scripts/unit-tests.mjs, byte-identical to 0f0e5a4. Only *.test.js: --list 80 parallel + 18 guard/kit = 98 = every test/*.test.js; nothing skipped (no other file under test/ imports node:test, no nested test files, no other test file uses .bootstrap or CLAUDE_PROJECT_DIR). Probe with CLAUDE_PROJECT_DIR=X: parallel step sees it, guard step has it unset (serial via --test-concurrency=1), a failing kit test exits 1, a never-exiting helper is not run. Per-test timeout 120 s kept (--test-timeout=120000). Watchdog: copy with the silence limit set to 3 s and a test that never ends: HUNG line names the step, exit 1, guard step still runs. Not blocking: on Windows the hang kill stops the runner, not its per-file children. Full suite not run by me (the gate's).
