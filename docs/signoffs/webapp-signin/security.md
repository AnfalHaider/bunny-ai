---
piece: webapp-signin
role: security
sha: 57c11a3
verdict: FAIL
date: 2026-11-18
---

# WEBAPP-SIGNIN (b), 57c11a3 (Security): FAIL, refusals can push device actions out of Activity

Branch claude/builder-b-webapp-signin, based on d235050. I read the server and UI diff. On an extract of 57c11a3 with an invented profile, `webapp-signin` and `remote-access` pass 52 of 52.

## What a requester who is not signed in learns: acceptable

- **The reasons.** Every refusal before sign-in now carries `reason` (`off`, `address`, `origin`, `passcode` or `wait`) and a fixed sentence. Nothing in it echoes the Host, the address, the port, a header or the passcode. The codes are unchanged.
- **`off`.** This is only reachable in the moment the listener is closing, since the device server is closed while access is off.
- **`address`.** This tells a wrong-Host requester, such as a DNS-rebinding page, that a Bunny is listening on this port. It doesn't tell it the right address. The sign-in page already shows Bunny to anyone who uses the right address, so this is a small fingerprint, not a leak. Accepted.
- **`passcode` and `wait`** say only what the sign-in page already said, with the same RA-1 limits.
- **The sign-in page and "Refused lately"** use `textContent`. The device label comes from `deviceLabel`, which reduces any User-Agent to a fixed vocabulary, so an attacker can't write words into the owner's Activity.

## WS-1 (MEDIUM, required): the refusal flood pushes real device actions out of the log

Refusals are written into the same action log as R-DF2's record of what devices did, and that log keeps only the last 500 entries. The limits are:
- one entry per reason and device kind per minute;
- at most 20 a minute.

A requester that never signs in can send wrong-Host or wrong-Origin requests, which need no passcode, at 20 entries a minute. In about half an hour that pushes every earlier entry out, including a device at Everything running `run_command`. The audit trail R-DF2 exists for can be erased by anyone on the network.

Probe (`docs/security/webapp-signin-probe/refusal-flood.mjs` on 57c11a3):

    minutes of refusals from a requester that never signed in: 32
    log size: 500; refused entries: 500
    the Everything device's run_command entry is GONE (pushed out by refusals)

**Fix (any one of these):**
- Keep refusals in their own list with their own cap (for example the last 100), so they never evict device entries.
- Or make pruning drop refusals first and never count them toward the 500.
- Or merge repeats into one entry with a count ("Refused 412 times between 14:00 and 14:32: address not allowed") instead of new entries.

Test: after hours of refusals, a device's earlier action is still in `actions()`.

## Smaller notes (fix with WS-1)

- **The disk.** Each refusal rewrites the whole log file, up to 20 times a minute with a 500-entry log. That's fine, but a refusal-only list (first option above) could be kept in memory only and not written at all.
- **The `refusedAt` map** is cleared when it passes 200 keys. With the fixed label vocabulary it stays far below that. Fine.

Verdict: FAIL at 57c11a3 for WS-1 only. Re-review the WS-1 diff with the probe above.

## Researcher's OPEN-SIGNIN note (cd10e9f): requirements wait for the owner's route

I'll set the rules once the owner picks the route. Whichever route it is, a tunnel such as Tailscale Funnel or Cloudflare makes every visitor arrive as 127.0.0.1, which breaks four things today:
- the per-IP RA-1 limit (one shared bucket for the whole internet);
- the exact Host pin (the public name);
- the Secure cookie (HTTPS at the edge, HTTP inside);
- the rule that the device server listens on the private address only.

The rules will need to cover:
- a global try limit, alongside per-session limits, that isn't keyed by IP;
- a Host and Origin pin to the one public name;
- `Secure` and `__Host-` cookies;
- the tunnel's own listener kept separate from the window's 127.0.0.1 server, so tunnel traffic can never be treated as the window;
- a passcode of 16 or more characters;
- Everything off for tunnel devices unless the owner agrees again.
