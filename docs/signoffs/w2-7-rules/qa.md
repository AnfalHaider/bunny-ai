---
piece: w2-7-rules
role: qa
sha: 8e42b6a
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at 47e2312. 8e42b6a is 47e2312 plus W2-7d (quote handling, phone Ask wrap) and two merges of lane A. Walk at 8e42b6a on an invented profile, my whole walk again: 36 of 36 gradable checks PASS (the 37th row, DK5, is UNKNOWN as before: the real Settings screen saving through the Electron preload needs the desktop shell). New and re-checked: Remove-Item with quotes inside the word (Remove, quote, minus Item, quote) is denied by a Remove-Item Deny in Manual and Auto, no card, file stays; git, quote, push, quote origin main still raises the Ask card for a git push* rule in Manual, Accept edits and Auto; on a 390 px phone the Ask prompt detail wraps (pre-wrap, no scroll inside the box, no sideways page scroll, card inside the viewport) in light and dark. Everything from before still passes: Q-W27-1 (bad PUT keeps rules), rm/del/cmd /c del/rm -Force -Recurse and a powershell -Command wrapper blocked, amber Blocked label, desktop build 403s for rules, default mode and chat mode over HTTP and the main-process path works, Plan mode wins, Try a command runs nothing. Builder's clean 7/7 gate at 8e42b6a was not repeated by QA. Walk script e2e/w27-walk.mjs. Electron not run.
