---
piece: w6-7
role: qa
sha: 5d7983d
verdict: PASS
date: 2026-11-17
---

W6-7 at 5d7983d, invented profile, real chat path with a scripted model. A failed grep, which, export, rm -rf, head, sed, chmod and cat line each end with a hint: This runs in PowerShell. grep -> findstr (or Select-String); and so on; one hint per word, words in quotes ignored (an echo of quoted grep rm sed with an unrelated failure has no hint). A command that works has none (echo; ls, which is a PowerShell alias). Touch, mkdir -p and set NAME=value succeeded on this machine (Git touch on the path, and PowerShell accepts the other two), so there was no failure to hint on; that is correct, my expectation was wrong. Finding, not blocking: the hint is added whenever the failed line contains a listed word even if that word works as an alias: cat missing.txt fails because the file is missing and the hint says cat -> type, which points at the wrong cause. Walk e2e/w6-w67-w68-w331-walk.mjs rows H.
