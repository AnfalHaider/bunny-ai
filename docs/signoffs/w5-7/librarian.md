---
piece: w5-7
role: librarian
sha: 2c29444
verdict: FAIL
date: 2026-11-16
---

Librarian FAIL until the Only from Bunny's window line names automatic updates and the busy fallback. The commit makes autoUpdate and fallbackWhenBusy window-only in src/server/settingKeys.js and windowOnly.js, so only Bunny's window can switch them. The lead line in src/ui/settings.html line 419 says the other settings that decide what Bunny may do are window-only, but it does not name them, and the automatic updates switch in the Settings row near line 550 has no note. Add to line 419: automatic updates and the busy fallback. No Claude credit in the message. Lessons L001 to L008 checked; none is newly due.
