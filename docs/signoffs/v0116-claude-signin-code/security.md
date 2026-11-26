---
piece: v0116-claude-signin-code
role: security
sha: a7a773ca
verdict: PASS
date: 2026-11-26
---

Moved from 43497419 (PASS there stands). 43497419..a7a773ca touches only service.js and its test. SB-1: wholeCallbackAddress takes the recorded browser address only with client_id, state, code_challenge and a redirect_uri of exactly http://localhost:<port>/callback, after signInUrlFrom's vendor-host check; otherwise the printed address and the paste box are offered. Tests cover a cut-off address, each missing part, a non-localhost, a non-/callback and an https callback. The file is read once and deleted (it held the one-time state and challenge); a file read mid-write is ignored and the code path is offered, which is the safe side. SB-2 (repeat the capture at every new pin) is Builder A's standing step for each pin's sign-off. Ran in an invented profile: engine-signin-code, engine-signin, window-only, remote-access: 77 pass, 0 fail.
