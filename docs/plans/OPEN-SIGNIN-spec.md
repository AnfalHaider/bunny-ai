# OPEN-SIGNIN: signing in from outside the home network (v0.1.14, HIGH)

Tech Lead, 2026-11-19.

## Inputs

**The owner's words** in the v0.1.14 wish list on main (017a514):
- "include outside the home network too";
- "yes tailsacle, also add other options the user may select one form settings";
- and the record that OPEN-SIGNIN is built to Security's safe defaults.

**The safe defaults:**
- **internet devices stay at Chats** (OS-7);
- **the internet route is off at every start** (OS-8).

Changing either needs the owner's own go.

**Research and requirements:**
- Researcher's details: 043f56f, `docs/research/2026-11-19-open-signin-details.md`.
- Security's OS-1 to OS-10: b6f9a11, `docs/security/2026-11-19-open-signin-requirements.md`. **These are binding.**
- BN-1 to BN-5, which the chip builds on: `docs/security/2026-11-19-banner-notice-requirements.md`.

Every LAN rule stays: S-1, RA-1, R1–R9, DEVICE-FULL, REMOTE-STAY and WEBAPP-SIGNIN. Where a LAN rule and an OS rule differ, the stricter one wins on the internet route.

Code references are to 07d6d2f.

**Order:**
1. Researcher's tests 1–5 run on the owner's PC.
2. This spec is revised from their results.
3. Design draws Settings.
4. Builder builds in the order of §10.
5. Security signs.

---

## 1. What the person gets

**Settings → Use Bunny in a browser** gains an **Outside your home network** block, under the existing "Allow other devices". It offers one choice:

| Route | What it needs | Bunny does |
|---|---|---|
| **Off** (always the state at start) | Nothing | Nothing listens for the internet. |
| **Tailscale Funnel** (the recommendation) | Tailscale installed and signed in on this PC (free Personal plan), with HTTPS and Funnel allowed for the tailnet | Runs `tailscale funnel` as its own child process, aimed at a loopback-only listener, and shows the public address. |
| **Your own HTTPS address** | A public name with a trusted certificate, and a proxy or tunnel on this PC that forwards to `127.0.0.1:<port>`. Caddy, a Cloudflare named tunnel and similar all fit here. | Opens the same loopback-only listener on a port the person points the proxy at, and pins the name they typed. |

Researcher found no other route that is free, needs no account and no domain, and passes Security's list (Research §3). So these three are the whole choice.

**What stays the same on every route:**
- the passcode;
- devices at **Chats**;
- the Activity record;
- a warning chip that cannot be dismissed (§7).

---

## 2. A second listener, loopback only (OS-1)

### 2.1 The listener

`src/server/app.js` gains `netServer`, the internet listener, next to `lanServer`. It is never the window's server, and never the LAN device server.

- **It binds `127.0.0.1` only.**
  - Funnel route: a free port, chosen when the route is turned on.
  - Own HTTPS route: the port saved as `internetPort` (§8.1), so the person's proxy setting stays valid across restarts.
- **The Funnel or proxy target is this port**, and only this port. A test shows the target is never the window's port and never the LAN port.
- **It is open only while the route is on.** It closes when:
  - the route is turned off;
  - Bunny quits;
  - Funnel's child process ends (§4.3);
  - the shut-off fires (§5.2).

### 2.2 One device-access type, two instances

`createRemoteAccess` (`remoteAccess.js`) is made from options, so one module serves both listeners:

```js
createRemoteAccess({
  via: 'lan' | 'internet',
  cookieName,                 // 'bunny_remote' (lan, today) | '__Host-bunny_remote' (internet)
  secureCookie,               // false (lan, plain HTTP) | true (internet)
  idleMs, maxAgeMs,           // lan: SESSION_IDLE_MS / EVERYTHING_IDLE_MS, no max age; internet: 30 min idle, 12 h max (OS-5)
  levels,                     // lan: ['chats', 'everything'] | internet: ['chats'] (OS-7)
  globalLimit,                // null (lan) | { fails: 10, perMs: 10 min, waitMaxMs: 1 h, shutoff: { fails: 100, perMs: 24 h } } (OS-3)
  scrypt,                     // the shared scrypt gate (§5.3)
  file, logFile, onEnd, onShutoff, now,
})
```

- **Each instance keeps its own session map, CSRF tokens and counters.** A LAN cookie is never looked up in the internet map, and the other way round (OS-1). The cookie names also differ, so a browser that holds both never sends the wrong one.
- **Every session carries `via`.** The window's device list shows "Home network" or "Internet" for each device.
- **The passcode record is shared**: one file, `remote-access.json`, and one passcode, with OS-4's stronger rules (§5.1).
- **The action log is shared** as well: one file, with `via` on every entry (§9).

### 2.3 One route function for both listeners

`remoteRoute` becomes `deviceRoute(access, pin)`, used by both listeners. Only two inputs differ:

| | LAN (today) | Internet |
|---|---|---|
| `pin.host` | `<LAN address>:<port>` (`remote.host`, `remoteAccess.js:373`) | Funnel: `Self.DNSName` with the trailing dot removed (plus `:8443` or `:10000` if not 443). Own HTTPS: the name typed in Settings, plus its port if not 443 (OS-6) |
| `pin.origin` | `http://<host>` | `https://<host>` |
| forwarded headers | all ignored (today) | §3 |

Everything after the pin checks is unchanged:
- sign-in, with RA-1's try reserved before scrypt;
- the CSRF check;
- `remotePolicy`;
- `remoteToolBlocked`;
- `isDeviceRefused` (CLI-ENGINES CE-6, SEARCH-PC §5);
- the Chats allow-list.

The internet listener **never enters the Everything branch**: `session.level` is always `'chats'` there (§6).

---

## 3. Headers: what is trusted (OS-2, OS-6)

On the internet listener, **the TCP peer must be loopback**. Anything else is refused. It cannot happen while the bind is `127.0.0.1`, but the check is cheap and catches a mistake.

**Funnel route:**
- **The funnel header.** Every request must carry `Tailscale-Funnel-Request: ?1`, or it is refused ("did not come through Funnel"). Tailscale deletes any incoming copy and sets its own, so a visitor cannot forge it (Research §1c).
- **The visitor's address.** It is "unknown" for every visitor **until Researcher's test 3 shows** that `X-Forwarded-For` is the real phone address on mobile data.
  - If it is, `trustForwardedFor: true` is set in code (not in a setting), for the Funnel route only, and the address feeds RA-1's per-visitor limit.
  - Until then, only the global limit counts (§5.2).

**Own-HTTPS route:**
- **The visitor's address** comes from exactly one header, the name the person typed (`internetClientIpHeader`, for example `CF-Connecting-IP`), read only from a loopback peer.
  - With none named, every visitor is "unknown".
  - `X-Forwarded-For` is **not** offered as a choice, because Cloudflare appends to it.
- **Settings says, under the field:** "Your proxy must replace this header, not add to it."

**Host and Origin, on both routes:**
- `Host` must equal `pin.host` exactly. `X-Forwarded-Host`, when present, must equal it too.
- `Origin`, when sent, must equal `pin.origin`. `Sec-Fetch-Site` must be `same-origin` or `none`.
- **Never trusted:** `X-Forwarded-Proto` and `X-Forwarded-Host` never set the pin or how a cookie is built.
- A local web page, or a DNS-rebinding page, that reaches `127.0.0.1:<port>` directly has the wrong Host and is refused.
- Refusals use WEBAPP-SIGNIN's reasons.

**Checking the own-HTTPS name** (OS-6), when it is saved:
- it is a hostname: letters, digits, `-` and dots, at most 253 characters, with labels of at most 63;
- no wildcard;
- no IP literal;
- not `localhost` or `*.localhost`;
- no scheme or path;
- an optional port of 443, 8443 or any 1024–65535, kept separately.

---

## 4. Driving Tailscale (OS-8)

All of this lives in **`src/server/funnel.js`**: pure Node, taking an injected runner, with fixed arguments only.

### 4.1 Finding and reading Tailscale

- **Finding it.** `tailscalePath()` uses `findOnPath(['tailscale.exe'])` (`safeExec.js:12`), then `%ProgramFiles%\Tailscale\tailscale.exe` **[R-1: the install path, from test 1]**.
  - It is probed with `tailscale version --json` and needs 1.38.3 or later.
  - It is run with `safeEnv`, `windowsHide`, and a 10 s timeout per call.
- **Reading its state.** `status()` runs `tailscale status --json`. From `BackendState`, `Self.DNSName`, `CertDomains` and `AuthURL`, it answers one of:

| State | Bunny shows |
|---|---|
| not installed | "Install Tailscale" (a link, opened in the person's browser on click) |
| `BackendState` not `Running` | "Open Tailscale and sign in". If `AuthURL` is present, a **Sign in** button opens it in the person's browser, on their click only |
| `CertDomains` empty | HTTPS not on yet. The device-name warning comes first (§4.2) |
| ready | Shows `Self.DNSName` |

**Bunny never runs `tailscale login` or `up --authkey`, and never stores a Tailscale key** (OS-8).

### 4.2 The device-name warning, before HTTPS

When the person chooses Funnel and `CertDomains` is empty, a dialog comes **before** anything is enabled:

> **This PC's name will be public.** Turning on HTTPS for Tailscale puts **`<Self.DNSName>`** in public certificate logs, and it can't be removed. If the name says who you are or where you live, rename this device in Tailscale first.
>
> [Rename in Tailscale] [Continue] [Cancel]

- **Rename in Tailscale** opens the Tailscale admin console's machines page in the person's browser. Then Bunny reads the status again.
- **Continue** goes on to enable (§4.3). Tailscale's own first-time consent page appears in the person's browser.
- **The words are Design's to draw.** The facts in the dialog are fixed: the name, that it becomes public, that it is permanent, and that renaming first is the advice.
- **It is shown again** whenever `CertDomains` is empty and the name has changed since the last confirmation.
- The person's "Continue" is recorded in Activity, with the name (§9).
- Researcher also notes that toggling HTTPS too often can hit Let's Encrypt's rate limit ("waiting 34 hours"), so the dialog never suggests turning it off and on again.

### 4.3 Turning the route on and off, without `--bg`

**On (Funnel):**
1. Open `netServer` on a free loopback port.
2. Spawn the **foreground** child: `tailscale funnel --https=443 http://127.0.0.1:<netPort>`. There is **no `--bg`**, so it ends with Bunny (OS-8). It uses stdio pipes, `windowsHide`, `safeEnv`, and a tree kill on stop.
3. Read its output:
   - a consent URL becomes a "Finish in your browser" button, on the person's click;
   - the "Available on the internet:" line confirms it is up.
   - The public URL is taken from `status --json` (`Self.DNSName`), never from prose output.
   - **[R-2: test 2: what the foreground form prints, whether it blocks on first-time consent with no console, and its exit codes.]**
4. Pin the host. Write `remote-internet.json` = `{ via: 'funnel', port: netPort, https: 443, name }`. That records the leftovers check below, **not** an on-state: nothing in it is read back as "on".
5. Activity gets "Internet route on", with the public name.

**If the child process ends by itself:**
- `netServer` closes at once;
- the chip and banner say "Tailscale Funnel stopped";
- Activity records it.
- Bunny does **not** restart it by itself.

**Off:**
1. Kill the child's tree.
2. Run the **targeted** `tailscale funnel --https=443 off`. **Never `funnel reset`**, which would remove a Funnel the owner set up for something else.
3. Close `netServer`.
4. Activity records it.

**Quit:** the same as Off, from the server's `close` handler and from Electron's `before-quit`.

**At every start**, before anything else in OPEN-SIGNIN:
1. If `remote-internet.json` names a port, run `tailscale funnel status --json`.
2. Run the targeted `off` for any Funnel whose target is `127.0.0.1:<that port>`. That covers a crash or a forced kill that left one behind.
3. The route itself is **never** turned on at start (OS-8).

**Only if R-2 shows the foreground form cannot work** does Bunny use `--bg`. Then the quit and start cleanup above become required, not belt-and-braces, and Security reviews the change again.

### 4.4 The own-HTTPS route

- **On:** open `netServer` on `internetPort`, and pin the saved name. Settings shows "Point your proxy at `http://127.0.0.1:<internetPort>` and keep the Host header." No child process is run.
- **Checking it works:** a **Check** button asks the person to open `https://<name>/` from their phone. Bunny shows "Seen a request through <name>" in Activity when the first correctly pinned request arrives. Bunny does not fetch its own public address, because no outbound request is needed.
- **Off and quit:** close `netServer`.

---

## 5. Passcode, try limits, scrypt (OS-3, OS-4)

### 5.1 The passcode

- **16 characters or more on the internet route.** If the saved passcode is shorter, turning the route on asks for a new one.
  - The suggestion is the generated 20-character passcode (`generatePasscode`, about 100 bits).
  - The LAN uses the same new passcode from then on.
- **Stronger scrypt:** `N=65536, r=8, p=1`. The record already stores its own `N`, `r` and `p` (`remoteAccess.js:61`), and `verifyPasscode` must **read the cost from the record**, not from the module constant.
  - **N=65536 with r=8 needs about 64 MB per hash.** Node's default `maxmem` is 32 MB, so every call passes `maxmem: 128 * 1024 * 1024`. Without it, scrypt throws, which would turn every sign-in into an error.
  - Turning the internet route on with an older record (N below 65536) asks for the passcode once, verifies it with the old cost, and rehashes it at the new cost.

### 5.2 The global limit and the shut-off (internet only)

- **The global wait.** 10 wrong passcodes in 10 minutes, from anyone on the internet listener, means every new internet sign-in waits.
  - The wait doubles each time: 1, 2, 4… minutes, up to 1 hour.
  - Signed-in sessions are not affected. The LAN counters are separate, so an internet flood never locks out the home network.
  - The window shows "Sign-ins from the internet are paused for N min", with a **Reset** button (window-only, device-refused: `POST /api/remote/internet/reset-wait`).
- **The per-visitor limit.** RA-1's per-visitor reserve-before-scrypt still applies to each visitor, but only when §3 trusts an address. Otherwise all visitors share one key, "unknown", and the global limit is what holds.
- **The shut-off.** 100 wrong passcodes in 24 hours turns the internet route **off by itself**. That runs §4.3's Off, and `onShutoff` shows a window notice: "Bunny closed the internet route after 100 wrong passcodes today."
  - Only the window turns it back on.
  - Activity records it.

### 5.3 One scrypt gate

`createScryptGate({ internet: 2, total: 4 })` is shared by both instances:
- **at most 2 internet sign-ins hash at once**; more get a 429 with `retry-after`;
- **at most 4 hash at once overall**, so 4 × 64 MB is the most memory scrypt can hold.

A try is reserved **before** taking a gate slot (RA-1 order), and released in `finally`.

---

## 6. Devices from the internet stay at Chats (OS-7)

- **The level stays Chats.** `setLevel(id, 'everything')` returns null for a `via: 'internet'` session. `PATCH /api/remote/devices/<id>/level` then answers 403 with "A device signed in from the internet stays at Chats."
- **No Everything to offer.** The first sign-in dialog (`chooseLevel`) and Settings → Change show **no Everything option** for an internet device, only a line: "Devices from outside your home network can only use Chats."
- **Chats rules hold unchanged:** every Chats-level block, `REMOTE_TOOLS_DENIED`, SEARCH-PC's denial (SP-5) and engines (CE-6).
- **Expiry:** an internet session ends after **30 minutes idle or 12 hours** from sign-in, whichever comes first (OS-5). `sessionFor` checks `now - signedInAt > maxAgeMs` as well as idle time.

## 7. The chip, the banner, the tray (OS-9, BN-2)

**While the internet route is on:**
- **The chip.** BN-2's chip in the window's top bar reads **`Open to the internet · <address>`**, in the **warning colour with words**.
  - It **cannot be dismissed** and never hides by itself.
  - It takes priority over "Open to devices · N". If a LAN device has Everything at the same time, the chip says both, for example "Open to the internet · Kitchen laptop has Everything". Design draws the exact form.
- **The banner** about the internet route never hides by itself. **A new internet sign-in always brings it back** (BN-3).
- **The tray tooltip** reads "Bunny AI: Open to the internet".
- **A device page** reached over the internet shows its level line (Chats) as today. It may be dismissed (BN-1).

A dismissal is never stored (BN-4).

## 8. Settings and routes

### 8.1 The settings

All of these are window-only (`WINDOW_ONLY_SETTING_KEYS`) **and** in `isDeviceRefused`, since an Everything device on the LAN counts as the window.

| Key | Values | Note |
|---|---|---|
| `internetRoute` | `'funnel'` \| `'https'` | Which route **On** uses. The on-state is never saved (OS-8). |
| `internetHttpsHost` | hostname, plus an optional port | §3 checks |
| `internetClientIpHeader` | `''` or one header name (letters, digits, `-`, at most 40) | Not `X-Forwarded-For` |
| `internetPort` | 1024–65535 | Chosen once at random. It can be changed, but never to the window's port or the LAN port |

### 8.2 The routes

All of these are under `/api/remote/`, so `isRemoteAdminPath` already refuses every device, Everything included. They are also window-only for writes:

- `GET /api/remote/internet`: `{ on, route, address, tailscale: <status from 4.1>, wait, failsToday }`
- `POST /api/remote/internet`: `{ on: true | false }`, plus a passcode when §5.1 asks for one
- `POST /api/remote/internet/reset-wait`

`GET /api/remote` (`remoteStatus`) adds `internet: { on, address }` and each device's `via`.

## 9. Activity (OS-10)

These go into the same window-only record as the device action log, with `via: 'internet'`:

| Entry | Holds |
|---|---|
| `signin` | the device label |
| `refused` | WEBAPP-SIGNIN's reason (wrong passcode, waiting, bad host, not through Funnel, too many at once) |
| `wait-start` / `wait-end` | the minutes |
| `shutoff` | |
| `route-on` / `route-off` | the route, the public name, and why it went off (person, quit, Funnel stopped, shut-off) |
| `name-warning` | the name confirmed (§4.2) |
| `proxy-seen` | own-HTTPS only, the first request |

**No visitor addresses are stored**, even when §3 trusts them for counting. They count, and are never saved.

---

## 10. Build order and tests

**Before any code:** Researcher's tests 1–5 run on the owner's PC with the owner's Tailscale, recorded as command plus output:
1. the install path and `status --json` fields;
2. the foreground form and consent;
3. the headers from a phone on mobile data;
4. chat streaming (SSE) through Funnel;
5. `off` and a reboot, with and without `--bg`.

Then this spec is revised: R-1, R-2, the `X-Forwarded-For` decision, and SSE.

**Build order:**
1. `createRemoteAccess` made from options, with `via`, cookie options, `maxAgeMs`, `levels`, the global limit and the scrypt gate (§2.2, §5). The LAN behaviour must stay byte-for-byte the same: all existing remote-access tests pass unchanged.
2. `deviceRoute(access, pin)`, with the internet header rules (§2.3, §3).
3. `netServer`, the own-HTTPS route, and the settings and routes (§4.4, §8).
4. `funnel.js` with the fake runner, then the Funnel route and the start-time cleanup (§4).
5. The window: Settings block, the name warning, the chip, the banner, the tray (§4.2, §7). Built from Design's drawing.
6. Activity entries, then help text and pictures (O7; PICTURE-CHECK once it lands).

**Tests** (fake Tailscale runner; real HTTP to `127.0.0.1`; invented profile; no network, so TEST-DNS's preload is in force):

| Test file | Proves (OS item) |
|---|---|
| `test/open-signin-listener.test.js` | `netServer` binds 127.0.0.1 only. The Funnel and proxy target is its port, never the window's or the LAN's. A LAN cookie is refused on the internet listener, and the other way round. The listener closes on off, on quit and when Funnel's child ends (OS-1). |
| `test/open-signin-headers.test.js` | Funnel: a missing `Tailscale-Funnel-Request` is refused, and a non-loopback peer is refused. `X-Forwarded-For` is ignored while `trustForwardedFor` is false. Own HTTPS: only the named header counts, and `X-Forwarded-For` cannot be chosen. `X-Forwarded-Proto` and `X-Forwarded-Host` never change the pin (OS-2). |
| `test/open-signin-pin.test.js` | Host must equal the pin, and so must `X-Forwarded-Host`. Origin must be `https://<pin>`. Sec-Fetch-Site is checked. **A direct `127.0.0.1` request with Host `127.0.0.1:<port>`, and a DNS-rebinding Host, are refused.** Invalid own-HTTPS names (wildcard, IP, localhost, scheme) are refused when saved (OS-6). |
| `test/open-signin-limits.test.js` | 60 parallel wrong passcodes give at most the allowed 401s, then waits (RA-1 on the internet listener). 10 wrong in 10 minutes pause every new internet sign-in, the wait doubles up to 1 hour, signed-in sessions keep working, **and the LAN listener still signs in**. Reset works from the window only. 100 in 24 hours shut the route off and record it. At most 2 internet scrypts run at once, and a 3rd gets 429 (OS-3). |
| `test/open-signin-passcode.test.js` | Turning on is refused with a passcode under 16. An old N=16384 record is rehashed to N=65536 after one confirmation, and `verifyPasscode` uses the record's own cost. **The scrypt call passes `maxmem`**, so a sign-in at N=65536 does not throw (OS-4). |
| `test/open-signin-cookie.test.js` | The internet listener sets `__Host-bunny_remote; Secure; HttpOnly; SameSite=Strict; Path=/`, with no Domain. The LAN listener keeps today's cookie and flags, with no `Secure`. The internet session ends after 30 minutes idle and after 12 hours even with activity (OS-5). |
| `test/open-signin-level.test.js` | `PATCH .../level` to `everything` for an internet device gives 403, and the device stays at Chats. `GET /api/remote` shows `via`. An internet device is refused SEARCH-PC's tools and every `REMOTE_TOOLS_DENIED` tool (OS-7). |
| `test/funnel.test.js` | The fake runner checks: the absolute path and fixed arguments, and **never `--bg`, `reset`, `login` or `up`**. Each `status --json` state maps to its screen. Off is the targeted `--https=443 off`. **At start, a leftover Funnel pointing at the recorded port is turned off, and one pointing elsewhere is left alone.** The route is never on at start. The child ending closes the listener (OS-8). |
| `test/open-signin-activity.test.js` | Every OS-10 entry is written, with `via: 'internet'`. **No entry holds an address**, even with `trustForwardedFor` on. The name-warning confirmation is recorded (OS-10). |
| e2e `open-signin.spec.js` | Settings: the route choice, the Tailscale states (fake), the name-warning dialog before HTTPS, the own-HTTPS fields and hints. The chip reads "Open to the internet · <address>" in the warning colour and has no dismiss. The banner comes back on a new internet sign-in. Both themes, at phone and desktop widths (O3, O8). |

**Security signs on:**
- Researcher's tests 1–5;
- the `X-Forwarded-For` decision from test 3;
- the test files above, specifically:
  - OS-1's per-listener sessions and target port;
  - OS-3's global wait and shut-off;
  - OS-5's cookie flags;
  - OS-6's Host, Origin and rebinding cases;
  - OS-7's refused level change;
  - OS-8's quit, start and leftover cleanup.

## 11. Open items

| Mark | What | From |
|---|---|---|
| R-1 | Tailscale's Windows install path, and the exact `status --json` keys (`CertDomains`, the capability key) | Test 1 |
| R-2 | Whether the foreground `tailscale funnel` works as a hidden child, including first-time consent | Test 2. If not, the `--bg` fallback and Security's re-review |
| R-3 | Whether Funnel's `X-Forwarded-For` is the real visitor | Test 3. Until it is shown, every visitor is "unknown" |
| R-4 | Whether SSE chat streaming works through Funnel | Test 4. If not, the route is not shipped, because chat would not stream |
| R-5 | Reboot behaviour with and without `--bg` | Test 5 |

**Owner questions:** none new. The safe defaults (Chats only; off at start) are already the owner's recorded choice for building. Raising either needs its own go, asked separately.
