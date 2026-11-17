---
piece: w6-13
role: security
sha: e061ce6
verdict: FAIL
date: 2026-11-17
---

download_file addresses, redirects, size and write location hold (33 private spellings, one DNS lookup used for the connect, 50 MB, same gate as write_file) but W613-1: permissionRules EDIT_TOOLS lacks download_file, so a Deny-edit rule on secrets/** is not applied (verified). One-line fix. See docs/security/2026-11-17-w6-13-w6-9-w6-21-review.md
