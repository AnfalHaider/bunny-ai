---
piece: k1-kit-0.6.0
role: security
sha: 8c39d76
verdict: FAIL
date: 2026-11-16
---

Staged kit-next at 8c39d76: attack list run, almost everything holds (19/19 checklist, ~50 protected-file spellings, 50 push spellings, ids on signoff/approve/require/piece, hooks identical). Blockers: K1-1 bootstrap role accepts path-like ids (../../AGENTS, ../../docs/a accepted in a throwaway repo); K1-2 nested-repo rule B7 holds only if the hook runs in the project folder. See docs/security/2026-11-17-k1-kit-next-review.md
