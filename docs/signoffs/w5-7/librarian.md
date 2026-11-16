---
piece: w5-7
role: librarian
sha: 32a3a8c
verdict: FAIL
date: 2026-11-16
---

Librarian FAIL until Settings help says what the window-only rule means. The commit makes the sign-in client settings window-only in the desktop app, and the server answers 403 with the message Change this in Bunny's window. No help text in src/ui/settings.html says that these settings change only from Bunny's window in the desktop app, or what that 403 message means. Add one line where the window-only settings are described (the Permission rules section near src/ui/settings.html line 416 and the sign-in client settings) and name the 403 message. No Claude credit in the message. Lessons L001 to L008 checked; none is due.
