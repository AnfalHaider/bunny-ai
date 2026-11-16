---
piece: release-0.1.5.1
role: qa
sha: 1456b5a
verdict: PASS
date: 2026-11-16
---

W0-4 walked on an invented profile with the default filter, light and dark, desktop and phone (28 checks, all PASS): no provider shows Add a provider and no Show all button; Anthropic fixture key shows 3 models are hidden and never No models available, the empty-state Show all models button and the picker trigger both reveal 3, the setting sticks, a model is picked and a local test reply arrives; NVIDIA plus Anthropic shows Show all models (3 more) in the open picker and 6 after; NVIDIA alone hides nothing and has no Show all. Walk script e2e/w04-walk.mjs. Electron shell not run.
