---
piece: release-0.1.7
role: librarian
sha: 6b06ed9
verdict: PASS
date: 2026-11-16
---

Librarian re-stamp of release-0.1.7 at the final build-fix sha 6b06ed9, after the review at 91b659f. The one change is scripts/build-css.mjs: it leaves src/ui/app.css alone when only the line endings differ, and keeps the file's own endings when the content changed. The imports include existsSync. No UI or visible text changed, so no help line is needed. README Publishing a new version steps (lines 188 to 194) still match the dist script, which is unchanged in package.json. The commit message has no Claude credit. The fix is inside 6b06ed9 itself (L007). Lessons L001 to L008 checked; none is newly due.
