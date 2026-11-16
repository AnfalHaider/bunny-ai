---
piece: w5-8
role: librarian
sha: 70bd964
verdict: FAIL
date: 2026-11-16
---

Librarian FAIL until the README release step names the new flags. scripts/release.mjs now refuses unless the target is exactly origin/main on a clean tree, and it takes --target and --dry-run. README.md line 131 still says only npm run release, with no mention of --dry-run (preview) or --target (default HEAD, which is refused unless it is origin/main). Add one line there naming both flags and the refusal. Other docs (docs/memory/logs/release-ops.md) already carry the recipe as a log, not as the user guide. No Claude credit in the message. Lessons L001 to L008 checked; none is due.
