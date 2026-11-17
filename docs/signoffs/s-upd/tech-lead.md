---
piece: s-upd
role: tech-lead
sha: ab1d2fc
verdict: PASS
date: 2026-11-17
---

Read electron/updater.js (6ac601a, ab1d2fc). No sha512 means refused before any download (check() and download()), and the digest must equal it (no longer optional). SUPD-1: sha512 taken from a column-0 line only, and it must be a base64 SHA-512 (86 chars + ==), so electron-builder's top-level line matches and the indented files[] entry and an empty key do not. SUPD-2: saved under basename(). compareVersions follows semver: 0.1.9-rc.1 < 0.1.9, numbers before words, +build ignored. scripts/release.mjs uploads dist/latest.yml and checks its version, so 0.1.9 carries the checksum the 0.1.8 updater already reads. Tests read, not run by me (gate slot).
