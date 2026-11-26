---
piece: v0116-claude-signin-code
role: security
sha: 43497419
verdict: PASS
date: 2026-11-26
---

HIGH (sign-in), owner's go recorded in the v0.1.16 live-fixes plan. Read service.js, app.js, engines.js, claude-code.js signInUrlFrom. A: record-browser.cmd only echoes its argument to browser-address.txt in the account folder; cmd's own parsing of %* is not a new boundary, because the only caller is the pinned, sha256-checked vendor program, which already runs as code, and the address it builds (client_id, base64url state and challenge, encoded redirect_uri) carries no text from a page or the model; Bunny reads the file as text and keeps only an https address on claude.ai, claude.com or anthropic.com, no user:pass, at most 4000 chars, and the page checks again before window.open (noopener). B: POST signin/code is under the window-only route and the device refusal (tests for both), needs a live run (409), checks 8 to 512 chars of a fixed set (400), 5 tries per run (429), writes the code and one newline to that run's stdin only, answers ok/signedIn/waiting with no echo, no log, no record; the field is a password field emptied on send. Ran in an invented profile: engine-signin-code, engine-signin, window-only, remote-access: 76 pass, 0 fail. LOW for later: delete browser-address.txt once read (it holds the one-time state and challenge); the 15 s wait per code request holds a request open (fine for one window).
