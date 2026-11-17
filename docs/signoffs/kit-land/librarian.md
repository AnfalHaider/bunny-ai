---
piece: kit-land
role: librarian
sha: 88bbd53
verdict: FAIL
date: 2026-11-17
---

Librarian review of kit-land at 88bbd53 (origin claude/kit-land-k2). FAIL. (1) The owner's words and question are recorded in docs/kit-changes/2026-11-17-kit-0.6.0.md and are correct. (2) The record's installed hashes do not match the committed files: all 47 entries differ from the blobs at 88bbd53 under both line-ending variants (e.g. .bootstrap/bin/adapt.mjs is recorded 5a4b9997 but the blob is 8b7fdb2a, which equals the plugin 0.6.0 file). The record must be regenerated from the landed files. (3) scripts/kit-next/README.md does not match what landed: line 3 still says nothing in .bootstrap/ or .githooks/ was touched and it is 'staged here, not landed'; it has no line that upgrade skips existing .githooks so the K-2 hooks were copied by hand. (4) docs/kit-changes/2026-11-17-tests/ (live-kitnext1.txt, live-no-kitnext.txt): searched for the owner's name, Windows user paths, key, token, secret, password and mail-address patterns; none found, test names only. Re-sign at the new sha after the record and README are fixed.
