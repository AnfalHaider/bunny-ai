---
piece: w6-5
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W6-5 at 304e71a, e2e/w65-walk.mjs 16 of 16. Page ranking (src/ui/model-abilities.js with invented lists): unavailable and cooling models skipped, an ended cool-down no longer hides a model, empty list is not a crash, Code ranks strong tool-use models first (qwen3-coder, claude, gpt-4o) and mini, flash and 8b after them, gemini-2.5-pro not read as weak, whyPicked gives strong at coding and tool use or the best coding model available here. Real server: a 429 busy answer rests only that model for about 120 s (other model of the same provider not cooling, list shows coolingUntil); a quota answer rests the whole provider for 60 min; a refused key is a provider problem with no timer; a 404 model does not exist marks the model unavailable; a 500 has no cool-down. Not run: the full Auto flow in the page across messages (ranking and server checked apart).
