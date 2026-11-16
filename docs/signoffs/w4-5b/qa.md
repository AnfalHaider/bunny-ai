---
piece: w4-5b
role: qa
sha: bac4ae5
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at f8ee7e8. Re-walk at bac4ae5 on an invented profile with a scripted thinking model, a step, and a 28 s silent model: e2e/w45b-walk.mjs 14 of 14 PASS, now with stricter checks. The Thought for Ns row sits BEFORE the step it led to, live (first order with a step is Thought then step) and in the saved and reopened chat (order Thought, step). The slow state at 390 px fits for model ids of 26, 43 and 50 characters and for a 52-character name (time inside the line, no sideways scroll, line 22 px) in light and dark. The word of the live line was never blank in any sample. Everything else from my first walk still holds: ONE live line at the bottom and no separate Thinking row through thinking, a step and thinking again; folded by default and opens to the streaming thinking; Show thinking opens it by default; slow state Hmph... and waiting for the model with the time after about 25 s and clearing on the answer; no live line or bunny when done; reopened chat shows the same Thought rows; an old chat shows Thought; one 22 px line at 390 px light and dark. Unit tests at bac4ae5: 554 pass, 0 fail. Gate not run by QA; Electron not run.
