---
piece: k2-guard
role: tech-lead
sha: 1d3a77c
verdict: PASS
date: 2026-11-17
---

Supersedes bec112e. Every git spawn now caps its timeout by the time left (spawnTimeout) and rechecks the deadline on failure; not-a-repo (git exit 128) still allows, but git missing, failing or slow with a policy-bearing CLAUDE_PROJECT_DIR refuses. Tests k2+k1+landing 45/45 (the timing check passed this time). Small note: a nonexistent cwd also counts as git broken, so it refuses (fail closed). e2e not run by me.
