---
piece: w6-21
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W6-21 at 304e71a, rows W621. A 38,000 character file reaches the model whole; a 90,000 character file and 3,000 rows of command output are cut to 50,000 with Cut to 50000 characters and the start and end kept; read_file says to use start_line and end_line; command output is saved whole in .bunny/notes with a .gitignore of *, and the note says so; over 128 KB says it is too large to be saved; output that looks like a secret is not saved.
