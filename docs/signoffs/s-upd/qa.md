---
piece: s-upd
role: qa
sha: ab1d2fc
verdict: PASS
date: 2026-11-17
---

e2e/w019-supd.mjs 38/38 against an invented feed and installer: a release with no latest.yml, no/empty/next-line/indented/hex/short sha512 is refused before any download (installer never requested); tamper and size mismatch discarded; odd asset names stay inside the download folder; semver table 16/16 incl. rc->final offered, final->rc not offered, same/older not offered. Note: a double-quoted sha512 value is refused (conservative; electron-builder writes it unquoted).
