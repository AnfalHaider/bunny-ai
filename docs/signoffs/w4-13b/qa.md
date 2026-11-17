---
piece: w4-13b
role: qa
sha: 61372c5
verdict: PASS
date: 2026-11-17
---

e2e/w019-w413b.mjs 30/30: ten known providers each get Low/Medium/High in their own field (Cerebras and Kimi Low/High only), seven unknown providers get nothing, 10 bad page values ignored, the choice replaces the Effort reasoning and Default falls back to Effort; a refusing model is retried once without the field and the person is told; an unrelated 400, a 500 and a second refusal are not looped; picker page shows Default/Low/Medium/High, Cerebras Default/Low/High, Mistral none, light/dark/phone; the choice rides with the message. Note: the choice is stored per model id, so the same model name on two providers shares one choice.
