---
piece: w6-9
role: security
sha: 55e3f20
verdict: PASS
date: 2026-11-17
---

W69-1 closed: read_url on a file: address is judged as read_file by the person's read rules (deny for .env, .ENV, secrets/k.txt, url-encoded, dot-segment, ADS and localhost forms, checked the way the runner does it); a file address with a host, UNC or device path is never looked up; containment unchanged. 50/50 tests.
