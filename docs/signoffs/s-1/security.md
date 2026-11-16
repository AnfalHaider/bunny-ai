---
piece: s-1
role: security
sha: 09b35e4
verdict: PASS
date: 2026-11-15
---

Supersedes the FAIL at ca01243. Invented-profile server: every earlier attack still refused (no or wrong token, bad Host by raw socket, foreign or null Origin, cross-site and same-site, preflight, HEAD, token in query). New callback: no state, made-up state, empty state, POST, trailing slash, other account routes and audio cross-site all refused; a started state passes once and is spent or expired after (their 32 guard and provider tests pass, 7 Google-return cases). Full e2e 92 of 92 pass, includes accounts, providers, artifact frames and the browser pane. Not tested: a real Google round trip, the packaged Electron window, a real provider key. Left for later: local connector confirm is still a request field; JSON content type not required.
