---
piece: w6-8
role: qa
sha: 5d7983d
verdict: PASS
date: 2026-11-17
---

W6-8 at 5d7983d, invented profile. run_command refuses npm start, npm run dev, npx vite, node server.js, python -m http.server, flask run, uvicorn, next dev, nodemon, and a trailing & (echo hi &, node worker.js &); nothing runs; the message says to call start_process with the command (the & dropped) and to browser_open the address after; start_process itself still starts a long program in Auto. Quoted ampersand, chained echo and node -e are not refused. Finding, not blocking: the npm pattern npm run (dev|serve) followed by a word boundary also refuses npm run dev:lint, npm run dev-check and npm run serve-docs as servers. The refusal is safe and recoverable (start_process works) but a short script with such a name gets the wrong advice and no exit status; fix: match only dev or serve followed by a space or the end. Walk rows S and T.
