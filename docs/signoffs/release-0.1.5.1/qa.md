---
piece: release-0.1.5.1
role: qa
sha: 75e02c1
verdict: PASS
date: 2026-11-16
---

Supersedes my sign-off at 1456b5a. W0-4 at 75e02c1 walked on an invented profile with the default filter, light and dark, desktop and phone: 42 checks PASS, none FAIL. No provider shows Add a provider, greeting visible, no Show all button. Anthropic fixture key: 3 models are hidden note replaces the greeting line, Show all models reveals 3 and the greeting returns, setting sticks, a model is picked and a local test reply arrives. NVIDIA plus Anthropic: the picker has a Show all models (3 more) option row, End reaches it (active, aria-activedescendant), it has accent colour in both themes, Enter shows all 6. NVIDIA alone hides nothing. Settings help line names the Show all models button (desktop only; found in the settings frame, not scrolled to the Models tab). Walk script e2e/w04-walk.mjs. Gate not run by QA; Electron not run.
