---
piece: release-0.1.5.1
role: qa
sha: dfebea3
verdict: PASS
date: 2026-11-16
---

Release is v0.1.6 (0.1.5.1 is not valid semver). dfebea3 is 75e02c1 plus a version bump only: git diff 75e02c1 dfebea3 changes just the version line in package.json and package-lock.json, 0.1.5 to 0.1.6. QA evidence at 75e02c1 carries over: gate 7/7 (unit 38s, e2e 204s) and 42 walk checks PASS (default filter, light and dark, desktop and phone: no provider shows Add a provider; Anthropic shows the hidden note, Show all reveals 3, a reply arrives; mixed picker has the keyboard-reachable Show all row; NVIDIA alone hides nothing; Settings help line). I did not re-run the gate at dfebea3; the Chief's gate is on it. Electron not run.
