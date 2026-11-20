---
piece: gate-marks
role: tech-lead
sha: 277cc305
verdict: PASS
date: 2026-11-20
---

GATE-MARKS at 277cc305 (one commit on 5fbb7975). The fix is the one in my finding: (✖|not ok)\b becomes (✖|not ok\b), the \b now binds only 'not ok', so spec-reporter ✖ lines (top-level, nested, 'failing tests:') are kept. The pattern moved unchanged otherwise into scripts/gate-marks.mjs as FAIL_MARKS and gate.mjs imports it; pass/fail is still the exit status, only the excerpt changes. Builder B's lists cover mine (✖ top and nested, not ok, every ℹ total, AssertionError, Error [ERR_, the four error kinds) and add good must-not lines (✔, ok, notok, a mid-line ✖, ℹ duration_ms, empty). The old-pattern test proves the bug; the end-to-end fixture proves a real failing run's test name is kept. Evidence: git archive 277cc305 into a scratch folder with a space, node v26.12.1, no-network preload: test/gate-marks.test.js 4/4; node --check scripts/gate.mjs ok. LOW, not blocking: the fixture run uses node's default reporter (spec on node 26 even when piped); pin --test-reporter=spec as unit-tests.mjs does, so a default change can't silently stop exercising the ✖ path. No Security needed: gate output only.
