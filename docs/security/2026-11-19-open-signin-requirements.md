# OPEN-SIGNIN (v0.1.14, HIGH): Security's requirements for opening Bunny to the internet

**The owner's choice:**
> "yes tailsacle, also add other options the user may select one form settings"

(Relayed by the Chief of Staff, 2026-11-19.) The routes are Tailscale Funnel, an own HTTPS address, and Off.

**Basis:** Researcher's details, 043f56f on claude/researcher-open-signin (`docs/research/2026-11-19-open-signin-details.md`).

These add to every LAN rule (S-1, RA-1, R1–R9, DEVICE-FULL, REMOTE-STAY, WEBAPP-SIGNIN). Where a LAN rule and one of these differ, the stricter one wins on the internet route. Each rule is OS-n, and Builder shows a test for each.

## OS-1: a separate listener, reachable only through the tunnel or proxy

- **Its own server**, bound to `127.0.0.1` only. It is never the window's server and never the LAN device server.
  - It serves exactly the device routes (`remoteRoute`'s sign-in page and allow-list), with its own pinned host and its own session map.
  - The Funnel or proxy target is this listener's port. A test shows the target is never the window's port.
- **Sessions are per listener.** A cookie from the LAN listener is refused on the internet listener, and the other way round.
- **It's open only while the internet route is on.** It is closed when the route is off, when Bunny quits, and whenever the route fails (see OS-8).

## OS-2: which headers to trust

The LAN listener ignores every forwarded header, as today. The internet listener follows these rules.

**Funnel route:**
- Every request must carry `Tailscale-Funnel-Request: ?1` and come from a loopback peer. Anything else is refused (it didn't come through Funnel).
- `X-Forwarded-For` is used as the visitor's address **only after Researcher's test 3 shows it's the real visitor address** (a phone on mobile data). Until then, all visitors count as one ("unknown"), and only the global limit in OS-3 applies.

**Own-HTTPS route:**
- Exactly one header name, which the person types in Settings (for example `CF-Connecting-IP` for a Cloudflare tunnel), read only from a loopback peer.
- With no header named, all visitors are "unknown".
- Settings says plainly that the proxy must overwrite that header, not append to it. `X-Forwarded-For` from Cloudflare isn't offered, since Cloudflare appends to it.

**Never trusted:** `X-Forwarded-Proto` and `X-Forwarded-Host` never change what Bunny pins or how it builds cookies. Those come from Settings or `tailscale status`, never from a request.

## OS-3: try limits that don't need an address

RA-1 stays: a try is reserved before scrypt. On top of the per-visitor limit (only when OS-2 trusts an address):

1. **A global limit on the internet listener:** 10 wrong passcodes in 10 minutes from anyone means every new sign-in there waits, doubling up to 1 hour.
   - Signed-in sessions aren't affected. The LAN listener keeps its own counters, so an internet flood never locks out the home network.
   - Bunny's window shows the wait and can reset it.
2. **A shut-off:** 100 wrong passcodes in 24 hours turns the internet route off by itself. Bunny closes the listener and runs Funnel `off`. The window says why, and only the window can turn it back on.
3. **scrypt runs on at most 2 sign-ins at once** on the internet listener. Others wait or get a 429, so CPU and memory can't be flooded.

## OS-4: the passcode

- **16 characters or more on the internet route.** Turning the route on asks the person to choose or confirm the passcode. The generated one (20 characters, about 100 bits) is the default suggestion.
- **Stronger scrypt for new records:** `N=65536` (from 16384), `r=8`, `p=1`. Turning on the internet route with a record made under the old cost asks for the passcode again and rehashes it.

## OS-5: cookies

- **The internet listener:** `__Host-bunny_remote`, with `Secure; HttpOnly; SameSite=Strict; Path=/` and no `Domain`. The CSRF header stays as it is.
- **The LAN listener (plain HTTP):** keeps today's name and flags. A `Secure` cookie isn't stored over `http://`, so `__Host-` must never be used there.
- **Expiry on the internet route:** 30 minutes idle and 12 hours at most, whatever the activity. The person signs in again after that.

## OS-6: Host and Origin pin

- **Host must be exactly the pinned name** (plus the port if it isn't 443). `X-Forwarded-Host`, when present, must equal it too.
  - **Funnel:** the name is `Self.DNSName` with the trailing dot removed, read from `tailscale status --json` when the route is turned on.
  - **Own HTTPS:** the name the person typed in Settings. It must be checked as a hostname: no wildcard, no IP literal, no `localhost`, no port beyond the allowed ones.
- **`Origin`, when sent,** must be `https://<that host>`. `Sec-Fetch-Site` must be `same-origin` or `none`.
- **Everything else is refused**, with WEBAPP-SIGNIN's reasons. This also refuses a local web page or a DNS-rebinding page that reaches the `127.0.0.1` listener directly, because its Host is not the pinned name.

## OS-7: no Everything for internet devices

- **Devices signed in through the internet route stay at Chats.**
  - The first-sign-in dialog and Settings → Change offer no Everything for them.
  - The server refuses `PATCH /api/remote/devices/<id>/level` to `everything` for a session from the internet listener (test it).
- **Raising this needs its own HIGH go from the owner,** with its own warning. The current R-DF1 warning is about the home network.
- **Every Chats-level block (R2) and every device-denied tool apply unchanged,** including SEARCH-PC (SP-5) and engines (CE-6).

## OS-8: start, quit, and Tailscale itself

- **Funnel runs as Bunny's child process, not with `--bg`,** so it ends with Bunny. `--bg` survives a reboot ("resumes after a reboot"), which would leave Bunny's port on the internet with nobody watching.
  - If the child-process form can't work (Researcher's test 2), then Bunny may use `--bg` only if:
    - it runs the targeted `tailscale funnel --https=<port> off` when it quits;
    - **at every start** it checks `tailscale funnel status --json` and turns off any Funnel pointing at a Bunny port.
  - **Never `funnel reset`.** It would remove a Funnel the owner set up for something else.
- **The internet route is off at every start.** REMOTE-STAY's "stay after restart" was the owner's answer for the home network only. Keeping the internet route on across restarts needs the owner's own word, asked separately. Security recommends against it.
- **Running Tailscale:**
  - It is started by absolute path (`findOnPath` or the probed install folder, R1), with `safeEnv` and fixed arguments.
  - Bunny never runs `tailscale login` or `up --authkey`, and never stores a Tailscale key.
  - A consent or `AuthURL` is shown to the person and opened in their own browser, only on their click.
- **Before HTTPS is first turned on,** the page that enables it says the PC's name will be public (Certificate Transparency logs) and suggests renaming the device first.

## OS-9: always visible (BN-2, made stricter)

- While the internet route is on, BN-2's chip reads `Open to the internet` with the address, **in the warning colour, and can't be dismissed.** The banner about it never hides by itself.
- The tray tooltip says the same.
- A new internet sign-in always brings the banner back.

## OS-10: Activity

- Kept in the same window-only record, with WEBAPP-SIGNIN's share for refusals:
  - each internet sign-in (device label, "internet");
  - refusals (reason, "internet");
  - the global wait starting and ending;
  - the shut-off;
  - the route turned on or off, with the time and the public name.
- **No visitor addresses are stored**, as on the LAN, even when OS-2 trusts them for counting.

## What Security signs on

- Researcher's tests 1–5 run and recorded (command plus output).
- The OS-2 decision on `X-Forwarded-For` taken from test 3.
- Tests for:
  - OS-1's per-listener sessions and that the target isn't the window port;
  - OS-3's global wait and shut-off;
  - OS-5's cookie flags;
  - OS-6's Host, Origin and rebinding cases;
  - OS-7's refused level change;
  - OS-8's quit, start and leftover-Funnel cleanup.
