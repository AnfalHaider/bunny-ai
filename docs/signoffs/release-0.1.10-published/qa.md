---
piece: release-0.1.10-published
role: qa
sha: db4ab9a
verdict: PASS
date: 2026-11-18
---

Published v0.1.10 (tag db4ab9a, published 2026-11-18T01:18:36Z), read-only with gh, real electron/updater.js, invented profile, nothing installed or run: e2e/w0110-published.mjs 14 of 14. Latest release is v0.1.10, not draft, not pre-release. Installer Bunny-AI-Setup-0.1.10.exe 122,362,712 bytes plus .blockmap and latest.yml, all uploaded; latest.yml names 0.1.10, the same file and size, sha512 /rRMMvrO... twice, identical. readRelease gives 0.1.10, the name, size and sha512. A copy set as 0.1.9 (also 0.1.8, 0.1.0) sees 0.1.10 and starts the download; a 1 KB stand-in body is refused by the checksum check and thrown away. 0.1.10 and 0.2.0 are told they have the latest version. The updater keeps the whole 4,253-character body and it equals the repository notes file v0.1.10-notes.md (line endings and outer whitespace ignored). NOT checked: that the published sha512 is the sha512 of the 122 MB installer (not downloaded); GitHub shows sha256 82153b85...
