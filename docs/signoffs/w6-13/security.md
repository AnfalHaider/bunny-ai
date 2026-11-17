---
piece: w6-13
role: security
sha: 55e3f20
verdict: PASS
date: 2026-11-17
---

W613-1 closed: download_file is in EDIT_TOOLS, a Deny-edit rule on secrets/x now answers deny for it (verified); W613-2 closed (::ffff:0:127.0.0.1 no longer public); W6-NEW-1 closed for download_file and the other edit tools (15 .git spellings refused incl. GIT~1, .git., ::$DATA, nested .git, a junction into .git; .gitignore and .github stay writable). 50/50 tests. Low: the .git pattern has an unescaped dot, so a file named agit or a folder xgit is refused too.
