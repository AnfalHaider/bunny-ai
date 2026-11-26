---
piece: v0116-local-models
role: security
sha: f7c917cc
verdict: PASS
date: 2026-11-26
---

T1-T3 fixes reviewed: in-flight count holds the idle stop and switch, a stopped Bunny local is refused and starts nothing (R2-3), a different local model is refused, the cold start re-reads the address after ensure; who may start a model and window-only routes unchanged; 203 related tests 202 pass 0 fail 1 skipped in an invented profile; T4 LOW for v0.1.17
