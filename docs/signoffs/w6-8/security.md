---
piece: w6-8
role: security
sha: 5d7983d
verdict: PASS
date: 2026-11-17
---

looksLikeServer only refuses (npm start/dev, vite, serve, node server.js, http.server, flask, uvicorn, next dev, nodemon, trailing &); the refusal names start_process and echoes the proposed command back to the model only. Undetected forms (cmd /c npm start, Start-Process) just run as before, with their card and rules. start_process keeps its own card and rules. No new spawn path.
