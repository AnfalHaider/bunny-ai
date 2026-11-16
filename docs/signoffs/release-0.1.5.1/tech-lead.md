---
piece: release-0.1.5.1
role: tech-lead
sha: 1456b5a
verdict: PASS
date: 2026-11-16
---

W0-4 diff read in full (chat.js, two CSS lines, new e2e). hiddenModelCount is allModelCount minus models.length, both set together in visibleModels, and all three assignments of state.models go through it, so no stale count. Boot order loads providers, settings, then models before the empty state reads them. showAllModels is click-only, writes modelFilter all through the normal settings route and keeps a chosen model. Add a provider shows only when none is connected. No i18n keys added, English only per the owner. node --check passes. e2e not run by me. Notes not blocking: Show all models changes the global Settings choice, so a person who chose free only on purpose and clicks it must set Settings back; the Show all row sits outside the arrow-key list; the strings are plain English literals outside say().
