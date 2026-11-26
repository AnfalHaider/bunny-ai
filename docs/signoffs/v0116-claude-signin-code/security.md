---
piece: v0116-claude-signin-code
role: security
sha: b5f7dd7e
verdict: PASS
date: 2026-11-26
---

Moved from a7a773ca (PASS there stands). a7a773ca..b5f7dd7e is SB-2 only, docs and one test: the sign-in capture records Claude Code 2.1.311, its sha256 (equal to the pin) and addressArrivedWhole true; canary-2026-11-24-pins.json keeps the same versions and hashes, only its note gains the SB-2 checklist line; test/canary-pins.test.js fails when the capture's version or sha256 differs from pins.json. No src change. Ran in an invented profile: canary-pins, engine-signin-code, engine-signin: 17 pass, 0 fail. The quick-integration merge 71c7c7d6 is not reviewed here.
