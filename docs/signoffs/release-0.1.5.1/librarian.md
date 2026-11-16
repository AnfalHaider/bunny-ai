---
piece: release-0.1.5.1
role: librarian
sha: 75e02c1
verdict: PASS
date: 2026-11-16
---

Librarian re-check of 1456b5a to 75e02c1. Help text: src/ui/settings.html line 359 now says the chat's Show all models button sets this to All, so the FAIL is cleared. Commit message has no Claude credit. L008 applied: models-default-filter spec covers the default path, and it now checks the greeting hides and returns. L005 applied: greeting id kept, the new row has its own id. L001 to L004 and L006 L007 checked, not applicable to this delta or already clean at the sha. Owner works in English only, so no i18n keys, as the Chief of Staff noted. Minor, not blocking: greeting stays hidden after boot in the empty-picker state until Show all models is used, check New chat still shows it.
