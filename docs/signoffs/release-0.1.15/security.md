---
piece: release-0.1.15
role: security
sha: 7c81da08
verdict: PASS
date: 2026-11-25
---

Moved from 2cd562ec (my PASS there stands). 2cd562ec..7c81da08 is docs and picture only: README.md (folder-trust alt text and one paragraph on the Run in Auto here question), docs/images/pictures.json (same alt text), docs/images/permission-rules.png (redrawn; I viewed it: invented rules, no folder names, no personal data). No change in src, electron, scripts or package.json. Gate 12/12 at 7c81da08 as reported by the Chief of Staff (not rerun by me). LOW for v0.1.16 docs: the new README sentence says Trust this folder for Auto runs commands and changes unless Bunny's check stops them, but the check does not look at edits inside the folder (G2); the Settings text in the picture is accurate. Open follow-ups unchanged from the 2cd562ec sign-off: G2-1 HIGH; IA-7b MEDIUM (a remote connector not on the curated list puts Install, keep off first; curatedLines wording); hard links; a link pointing nowhere used as a parent refused by mkdir (LOW); real file links untested without developer mode; earlier LOWs.
