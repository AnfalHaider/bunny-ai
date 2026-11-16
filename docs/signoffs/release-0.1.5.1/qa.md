---
piece: release-0.1.5.1
role: qa
sha: 75e02c1
verdict: PASS
date: 2026-11-16
---

Supersedes my sign-off at 1456b5a. Gate run by QA at 75e02c1: 7/7 (unit 38s, e2e 204s). W0-4 walked on an invented profile with the default filter, light and dark, desktop and phone: 42 checks PASS, none FAIL. No provider: Add a provider, greeting visible, no Show all button. Anthropic fixture key: the 3 models are hidden note replaces the greeting, Show all models reveals 3, greeting returns, setting sticks, a model is picked and a reply arrives. NVIDIA plus Anthropic: picker has a Show all models (3 more) option row, End reaches it, accent colour in both themes, Enter shows all 6. NVIDIA alone hides nothing. Settings help line names the Show all models button (desktop only; found in the settings frame, not scrolled to the Models tab). Walk script e2e/w04-walk.mjs. Electron not run.
