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

## Revision after the owner's decision (2026-11-19): OS-5, OS-7 and OS-8 rewritten

The owner's words, relayed by the Chief of Staff (HIGH go; main records it), after seeing OS-7 and OS-8 in Design's drawing:

> "Internet devices should be allowed to use the application as normal, since every user will be signing into their own systems only, also there should be no time out, if security needs it then add options in settings to allow full use and no expiry, if enabled once it should remain enabled, this is supposed to be a refined version of claude's RC."

This revision **replaces** OS-5's expiry, OS-7 and OS-8's "off at every start".

**Unchanged:**
- OS-1: a separate loopback listener with its own sessions;
- OS-2: header trust;
- OS-3: the non-IP try limit, the shut-off after 100 wrong tries, at most 2 scrypt checks at once;
- OS-4: 16 or more characters, the stronger scrypt;
- OS-5's cookie flags;
- OS-6: the Host and Origin pin;
- OS-9: the chip, made explicit below;
- OS-10: Activity.

### OS-5 (revised): sessions, and an option for no expiry

**The cookie** stays `__Host-bunny_remote; Secure; HttpOnly; SameSite=Strict; Path=/` on the internet listener, with the CSRF header as now.

**A new Settings option, "Keep devices signed in" (window-only, saved).**
- **Off:** 30 minutes idle and 12 hours at most, as before.
- **On:**
  - no idle limit and no maximum;
  - the cookie gets `Max-Age` of 400 days, the most browsers keep;
  - sessions survive a restart: Bunny saves **only the SHA-256 of each session secret** (never the secret itself), with its CSRF value, device label, level and last seen, in a file in the data folder. On a request, Bunny hashes the cookie and looks it up, comparing with `timingSafeEqual`.
- Turning it on shows one sentence: "Devices stay signed in until you sign them out here, change the passcode or turn this off."
- It stays on until the owner turns it off.

**Even with the option on, a session ends at once when the owner:**
- signs that device out, or uses "Sign out all devices";
- changes the passcode;
- turns the option off, which ends every session older than 12 hours;
- turns off the internet route;
- or when OS-3's shut-off fires.

Every one of these deletes the saved hashes. The device list in Settings shows each internet device with its first and last seen.

**LAN sessions** follow the same option, but keep REMOTE-STAY's "every device signs in again after a restart" unless the owner turns on the same option for the home network separately. This is recommended off.

### OS-7 (revised): internet devices may have Everything

- An internet device starts at **Chats**, the default, as on the LAN. The first-sign-in dialog asks, as DEVICE-FULL does.
- **Only Bunny's window can raise it to Everything**, per device, through the existing window-only level route. The server still refuses a level change from any device, Everything included.
- **The dialog shows R-DF1's warning, plus one internet sentence:** "This device signed in over the internet. Anyone who has your passcode, anywhere, could sign in the same way. Give Everything only to a device you own."
- The R-DF1 box in Settings stays while any device has Everything.
- **A new Settings option, "Everything stays on" (window-only, saved).**
  - **Off:** an Everything device drops back to Chats after 30 minutes idle, as now.
  - **On:** Everything has no idle limit. With "Keep devices signed in", it also survives a restart.
  - It stays on until the owner turns it off.
- **Activity** records each grant and each drop to Chats, saying "internet" for internet devices, alongside R-DF2's tool and route record.

### OS-8 (revised): the route stays on after a restart, with start-up checks

**A Settings option, "Stay open to the internet after a restart"** (window-only, saved; on once the owner turns it on). At each start, Bunny reopens the internet route **only if all of these pass.** Otherwise it stays closed and the row says which check failed, in one sentence.

1. **The saved passcode record** exists with the OS-4 scrypt cost.
2. **OS-3's shut-off hasn't fired.** After a shut-off the route stays closed across restarts until the owner turns it on in the window.
3. **For Funnel:**
   - `tailscale status --json` shows the backend running (`BackendState`);
   - `Self.DNSName` (trailing dot removed) equals **the saved pinned name**. A renamed machine or another tailnet means closed;
   - the Funnel capability is present.
   - Tailscale is started by absolute path with `safeEnv`, as OS-8 already says.
4. **Leftovers:** `tailscale funnel status --json` is read first. Any Funnel pointing at a port that isn't this start's internet listener is turned off with the targeted `off`, never `reset`. Only then does Bunny start its own Funnel, **as a child process**. A `--bg` Funnel is still never left behind on purpose.
5. **For own HTTPS:** the saved host name passes OS-6's hostname check. The listener reopens on loopback. Bunny can't check the owner's proxy, so the row says "Open through your own address".

**Every reopen is visible:**
- the chip reads `Open to the internet`, in the warning colour and impossible to dismiss (OS-9);
- the banner comes back (BN-3);
- the tray tooltip says so, and the start notification names the address;
- Activity records "reopened at start" with the time and the pinned name.

**Quitting Bunny** ends its child Funnel. Saved sessions (OS-5) stay valid only if "Keep devices signed in" is on.

### What these options can't switch off

The non-IP try limit and the shut-off (OS-3), the passcode length and cost (OS-4), the Host and Origin pin (OS-6), the header-trust rules (OS-2), the visible chip (OS-9), and the record (OS-10) apply whatever the options say. **None of the options can be changed by any device, Everything included.** They join the device-refused set, like `isRemoteAdminPath`.

### Tests Security will look for (added)

- With "Keep devices signed in" on, a restart keeps a session. The saved file holds no secret, only hashes. Sign out, sign out all, a passcode change and turning the option off each end it.
- An internet device raised to Everything by the window gets the dialog with the internet sentence. A level change from a device is refused at Everything.
- At start with "Stay open" on, each failed check keeps the route closed with its sentence: a renamed DNS name, Tailscale stopped, no passcode record, an earlier shut-off. A leftover Funnel on another port is turned off. A good start reopens, shows the chip, and writes the Activity entry.
- No device can change any of the three options.

### Addendum: "Keep devices signed in" covers home-network devices too (2026-11-19)

The Chief of Staff reads the owner's "there should be no time out" as covering every device. So the OS-5 option, and the OS-7 "Everything stays on" option, apply to **LAN devices as well**. This replaces "LAN sessions keep REMOTE-STAY's sign-in-again" above. It amends DEVICE-FULL's 30-minute Everything limit and BROWSER step 2's 2-hour Chats limit, **only while the option is on**.

- **One option, both routes.** With "Keep devices signed in" on, a LAN session has no idle limit and no maximum, and survives a restart. As on the internet, Bunny saves only the SHA-256 of each session secret, never the secret. The LAN cookie keeps its current name and flags (plain HTTP, so no `Secure` or `__Host-`), with `Max-Age` of 400 days.
- **"Everything stays on"** likewise removes the 30-minute drop for LAN devices at Everything.
- Both stay on once the owner turns them on. Turning one off brings back today's limits, and ends every session older than those limits.
- **What still ends a LAN session at once:** signing it out, "Sign out all devices", a passcode change, turning device access off, and REMOTE-STAY's network check failing at start (RS-4). A LAN session saved under one network isn't reopened on another network.
- **Plain HTTP on the LAN:** a long-lived session over plain HTTP can be taken over by anyone on the same network who sees its traffic. That's the risk R-DF1 and the access warning already state. With this option on, the warning adds: "Devices stay signed in until you sign them out. On a network you don't fully trust, turn this off." It's the owner's choice and stays visible in Settings.
- **The device list** in Settings shows each device's first and last seen, so a forgotten device can be found and signed out.
- **No device can change either option**, Everything included.

Tests: with the option on, a LAN Chats session is still valid after 3 simulated hours, and an Everything session after 45 simulated minutes. Both survive a restart, with only hashes saved. Each of the end-at-once events still ends them. With the option off, today's 2-hour and 30-minute limits hold.
