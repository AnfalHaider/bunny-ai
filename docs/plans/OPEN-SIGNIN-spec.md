# OPEN-SIGNIN: signing in from outside the home network (v0.1.14, HIGH), revision 3

Tech Lead, 2026-11-19. Revision 3 replaces bacd595 (revision 2) and 48b67ba (revision 1). **Addition after 2fecff1:** Security's BN-7 addition makes the flood shut-off a chip event that stays visible with no access open (§7.2).

**What revision 3 changes:** Security answered both of revision 2's questions.
- **705e7cf (the LAN addendum):** "Keep devices signed in" and "Everything stays on" cover **home-network devices too**, since the owner said "there should be no time out". So one `keepSignedIn` covers both listeners, and `keepSignedInLan` is gone (§6.2, §8.1).
- **08c6789 (BN-6 to BN-9):** the chip carries everything.
  - Events show as the chip's words, with a count badge and `aria-live`.
  - Nothing goes back on a timer. A click opens the devices list, or the device's Activity.
  - The "<device> changed a setting" notice becomes a chip event.
  - **No notification for a sign-in**, beyond the tray tooltip and the one-time start notification (§7).

**What revision 2 changed:** two owner decisions, and Security's rewrite of OS-5, OS-7 and OS-8 (64374ea):
1. **Internet devices are used as normal.** The owner's words, relayed by the Chief of Staff (a HIGH go; recorded on the Chief's main, quoted from 64374ea): "Internet devices should be allowed to use the application as normal, since every user will be signing into their own systems only, also there should be no time out, if security needs it then add options in settings to allow full use and no expiry, if enabled once it should remain enabled, this is supposed to be a refined version of claude's RC." So three window-only options are saved, and stay on once turned on (§8.1):
   - **Keep devices signed in** (OS-5): no expiry, and sessions survive a restart, with only hashes saved;
   - **Everything stays on** (OS-7): Everything is allowed for internet devices, from the window, with the internet sentence, and has no idle drop (on both listeners, 705e7cf);
   - **Stay open to the internet after a restart** (OS-8): the route reopens at start, only after the start-up checks.
2. **No banner on top anywhere, only the devices chip.** The owner, relayed by the Chief of Staff: "No banner on top is required." Asked where: "Everywhere". Wherever OS-8 or BN-3 says "the banner", this spec means **the chip and the tray**, as BN-6 to BN-9 (08c6789) set out.

What did not change: OS-1, OS-2, OS-3, OS-4, OS-5's cookie flags, OS-6, OS-9 and OS-10. **None of the new options can switch any of those off**, and **no device can change any of the options**.

## Inputs

**The owner's words** in the v0.1.14 wish list on main (017a514):
- "include outside the home network too";
- "yes tailsacle, also add other options the user may select one form settings";
- and the record that OPEN-SIGNIN is built to Security's safe defaults.

**The defaults** (before the person turns an option on):
- internet devices start at **Chats**;
- sessions expire (30 minutes idle, 12 hours at most);
- the route is **off** after a restart.

The owner's decision 1 (above) allows each to be changed by its own option in Bunny's window. Once turned on, an option stays on until the owner turns it off.

**Research and requirements:**
- Researcher's details: 043f56f, `docs/research/2026-11-19-open-signin-details.md`.
- Security's OS-1 to OS-10: b6f9a11, with OS-5, OS-7 and OS-8 rewritten at 64374ea, in `docs/security/2026-11-19-open-signin-requirements.md`. **These are binding.**
- BN-2, BN-4 and BN-5, plus **BN-6 to BN-9** (08c6789), which replace BN-1 and BN-3: `docs/security/2026-11-19-banner-notice-requirements.md`.
- The LAN addendum to OS-5 and OS-7: 705e7cf, in the OPEN-SIGNIN requirements.

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
| **Off** (the state at start, unless "Stay open to the internet after a restart" is on and its checks pass, §4.5) | Nothing | Nothing listens for the internet. |
| **Tailscale Funnel** (the recommendation) | Tailscale installed and signed in on this PC (free Personal plan), with HTTPS and Funnel allowed for the tailnet | Runs `tailscale funnel` as its own child process, aimed at a loopback-only listener, and shows the public address. |
| **Your own HTTPS address** | A public name with a trusted certificate, and a proxy or tunnel on this PC that forwards to `127.0.0.1:<port>`. Caddy, a Cloudflare named tunnel and similar all fit here. | Opens the same loopback-only listener on a port the person points the proxy at, and pins the name they typed. |

Researcher found no other route that is free, needs no account and no domain, and passes Security's list (Research §3). So these three are the whole choice.

**What stays the same on every route:**
- the passcode;
- devices start at **Chats**, and only the window can raise one to Everything (§6);
- the Activity record;
- a warning chip that cannot be dismissed (§7).

**Three options sit under the route choice** (all window-only, saved, on until turned off):
- Keep devices signed in;
- Everything stays on;
- Stay open to the internet after a restart.

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
  limits: () => ({ idleMs, maxAgeMs, everythingIdleMs }),  // read on every check, from the options (§6):
                              //   lan: SESSION_IDLE_MS, no max age, EVERYTHING_IDLE_MS (unless "Everything stays on": none)
                              //   internet, Keep devices signed in OFF: 30 min idle, 12 h max; ON: none (OS-5)
  persist,                    // null | { file }: "Keep devices signed in" (§6.2); only SHA-256 hashes of secrets are written
  levels,                     // ['chats', 'everything'] for both listeners (OS-7 revised)
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

The internet listener enters the Everything branch only for a device **the window** raised to Everything (§6). The device-refused set still applies there: `isRemoteAdminPath`, `isDeviceRefused`, and the three new options.

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
4. Pin the host. Write `remote-internet.json` = `{ via: 'funnel' | 'https', port: netPort, https: 443, name, on: true }`. It records the leftovers check below. **`on` is read back at start only when "Stay open to the internet after a restart" is on**, and only through §4.5's checks.
5. Activity gets "Internet route on", with the public name.

**If the child process ends by itself:**
- `netServer` closes at once;
- the chip and the tray say "Tailscale Funnel stopped";
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
2. Run the targeted `off` for any Funnel whose target is a port that **isn't this start's internet listener** (OS-8 revised, check 4). That covers a crash or a forced kill that left one behind. A Funnel pointing anywhere else, not at a Bunny port, is left alone.
3. Then the route is reopened **only** through §4.5, and only when the option is on. Otherwise it stays off.

**Only if R-2 shows the foreground form cannot work** does Bunny use `--bg`. Then the quit and start cleanup above become required, not belt-and-braces, and Security reviews the change again.

### 4.4 The own-HTTPS route

- **On:** open `netServer` on `internetPort`, and pin the saved name. Settings shows "Point your proxy at `http://127.0.0.1:<internetPort>` and keep the Host header." No child process is run.
- **Checking it works:** a **Check** button asks the person to open `https://<name>/` from their phone. Bunny shows "Seen a request through <name>" in Activity when the first correctly pinned request arrives. Bunny does not fetch its own public address, because no outbound request is needed.
- **Off and quit:** close `netServer`.


### 4.5 Reopening after a restart (OS-8 revised)

The option is **Stay open to the internet after a restart**: window-only, saved, and on once the owner turns it on.

When the option is on and `remote-internet.json` says `on: true`, Bunny reopens at start **only if every check passes**. Otherwise it stays closed, and the Settings row says which check failed, in one sentence:

| # | Check | The sentence when it fails |
|---|---|---|
| 1 | The saved passcode record exists, with OS-4's cost (N=65536) | "Not reopened: the passcode was not found. Turn it on again." |
| 2 | OS-3's shut-off has not fired since it was turned on. The shut-off is saved as `shutoffAt` in `remote-internet.json` and cleared only by the window's On | "Not reopened: Bunny closed it after too many wrong passcodes. Turn it on again here." |
| 3 | **Funnel:** `tailscale status --json` shows `BackendState` running; `Self.DNSName`, with the trailing dot removed, **equals the saved pinned name**; the Funnel capability is present. Tailscale is started by absolute path with `safeEnv` | "Not reopened: Tailscale is not running" / "this PC's Tailscale name changed" / "Funnel is not allowed for this PC" |
| 4 | **Funnel:** leftovers are turned off first (§4.3 start, step 2). Only then does Bunny start **its own Funnel as a child process**. A `--bg` Funnel is never left behind on purpose | |
| 5 | **Own HTTPS:** the saved host name passes OS-6's hostname check. The listener reopens on loopback. Bunny can't check the owner's proxy, so the row says "Open through your own address" | "Not reopened: the saved address is not a valid name." |

**Every reopen is visible:**
- the chip reads `Open to the internet · <address>`, in the warning colour and impossible to dismiss (§7);
- the tray tooltip says so;
- the start notification names the address;
- Activity records `reopened-at-start`, with the time and the pinned name.

**Quitting Bunny** ends its child Funnel. Saved sessions survive only if "Keep devices signed in" is on (§6.2).

This is not REMOTE-STAY's resume. It is a separate check list, in `resumeInternet()` next to `resumeRemote()`. It runs alongside the window's start (START-WAIT), never before it.

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
  - Only the window turns it back on. `shutoffAt` is saved, so "Stay open after a restart" does **not** reopen it (§4.5, check 2).
  - It also **ends every internet session**, and deletes the saved hashes (§6.2).
  - Activity records it.

### 5.3 One scrypt gate

`createScryptGate({ internet: 2, total: 4 })` is shared by both instances:
- **at most 2 internet sign-ins hash at once**; more get a 429 with `retry-after`;
- **at most 4 hash at once overall**, so 4 × 64 MB is the most memory scrypt can hold.

A try is reserved **before** taking a gate slot (RA-1 order), and released in `finally`.

---

## 6. Devices from the internet: levels and sessions (OS-5 and OS-7, revised)

### 6.1 Levels: Everything from the window, never from a device

- **Every internet device starts at Chats**, the default. The first sign-in dialog asks about it, as DEVICE-FULL does.
- **Only Bunny's window can raise it to Everything**, per device, through the existing window-only route `PATCH /api/remote/devices/<id>/level`. A level change from any device is refused, Everything included (`isRemoteAdminPath`).
- **The dialog for an internet device** (`chooseLevel`, and Settings → Change) shows R-DF1's warning **plus** this sentence, exactly:

  > This device signed in over the internet. Anyone who has your passcode, anywhere, could sign in the same way. Give Everything only to a device you own.

  The red R-DF1 box in Settings stays while any device has Everything.
- **At Everything**, an internet device is treated as the window, as DEVICE-FULL does. That excludes `/api/remote*` and everything in `isDeviceRefused`: engines, SEARCH-PC's settings and Open, the three options here, and the internet routes.
- **The "Everything stays on" option** (window-only, saved):
  - **Off:** an Everything device drops back to Chats after 30 minutes idle (`EVERYTHING_IDLE_MS`, R-DF1).
  - **On:** Everything has no idle limit. With "Keep devices signed in", it also survives a restart (§6.2).
  - **Scope: both listeners** (Security's LAN addendum, 705e7cf). On the home network it removes DEVICE-FULL's 30-minute Everything drop, **only while the option is on**. Turning it off brings the 30-minute limit back, and drops to Chats every Everything device idle for longer.
- **Activity** records each grant, and each drop to Chats (by a person, idle, sign-out), with `via`.

### 6.2 Sessions: "Keep devices signed in"

**One option, both listeners** (705e7cf). The cookies are unchanged, except for `Max-Age` while the option is on:
- **internet:** `__Host-bunny_remote; Secure; HttpOnly; SameSite=Strict; Path=/`, plus the CSRF header;
- **home network:** today's `bunny_remote; HttpOnly; SameSite=Strict; Path=/`. Because it is plain HTTP, there is no `Secure` and no `__Host-`.

**The option** (window-only, saved):
- **Off**, the default: today's limits.
  - **internet:** a session ends after **30 minutes idle or 12 hours** from sign-in, whichever comes first. `sessionFor` checks `now - signedInAt > maxAgeMs` as well as idle time;
  - **home network:** BROWSER step 2's 2-hour idle for Chats, DEVICE-FULL's 30 minutes for Everything, and REMOTE-STAY's "every device signs in again after a restart".
- **On:**
  - no idle limit and no maximum;
  - the cookie gets `Max-Age=34560000` (400 days, the most browsers keep);
  - **sessions survive a restart, on both listeners.** `remote-sessions-internet.json` and `remote-sessions-lan.json` in the data folder hold, per session, `{ sha256(secret), csrf, deviceId, label, level, signedInAt, lastSeen }`. **The secret itself is never written.**
    - On a request, Bunny hashes the cookie with SHA-256 and looks the hash up.
    - The lookup compares with `timingSafeEqual`, over hashes of equal length.
    - The file is written atomically (a temp file, then a rename), and is readable only by the data folder's owner, as `remote-access.json` is.
- **Turning it on** shows one sentence: "Devices stay signed in until you sign them out here, change the passcode or turn this off."
- **The access warning on the home-network row** adds, while the option is on (705e7cf): "Devices stay signed in until you sign them out. On a network you don't fully trust, turn this off." A long-lived session over plain HTTP can be taken over by anyone on the same network who sees its traffic. That is the risk R-DF1 already states. It is the owner's choice, and it stays visible in Settings.

**Even with the option on, a session ends at once, and its saved hash is deleted, when:**
- the window signs that device out, or uses **Sign out all devices**;
- the passcode changes;
- the option is turned **off**, which ends every session older than today's limits: 12 hours on the internet, and the 2-hour or 30-minute idle on the home network;
- **internet:** the internet route is turned **off** by the person, or OS-3's shut-off fires;
- **home network:** device access is turned **off**, or REMOTE-STAY's network check fails at start (RS-4). A LAN session saved under one network is never reopened on another network.

**Quitting Bunny does not end saved sessions.** That is the point of the option. They are valid again when the route reopens (§4.5).

**The device list** in Settings shows each device with its `via` (Home network / Internet), its level, first seen and last seen.

**Chats rules hold unchanged** for Chats devices: every Chats-level block, `REMOTE_TOOLS_DENIED`, SEARCH-PC's denial (SP-5) and engines (CE-6).

## 7. The chip and the tray, with no banner (OS-9; BN-6 to BN-9, 08c6789)

**There is no banner or notice anywhere:** not in Bunny's window, not on a device page, and not in a browser page on the PC. The chip does the notice's job.

**Removed:**
- `#remote-note` (the window's banner);
- `#device-note` (the device page's level line);
- `#device-notice` (DEVICE-FULL's bottom-right "<device> changed a setting").

### 7.1 What the chip shows, always (BN-6)

The chip appears on every Bunny page on the PC, in its top bar, while device access is open. It has `role="status"`, and the full words are in `aria-label`, so colour is never the only sign. At a narrow width it shortens its words, but it never disappears.

| State | Chip |
|---|---|
| Open, no device at Everything | `Open to devices · N` (normal colour) |
| Any device at Everything | warning colour: `Pixel 8 has Everything` / `Everything: 2 devices` |
| The internet route is on | warning colour: `Open to the internet · N`, combined with Everything when both apply. The address is in its `aria-label` and in Settings |

### 7.2 Events: the chip says what happened, until it's clicked (BN-7, BN-8)

**An event is any of these, while the page is open:**
- a device signs in, on either listener. This is compared **by device id, not by count**, so a sign-out and a sign-in between two looks still counts (BN-L1);
- a device is raised to Everything;
- the internet route reopens at start (§4.5);
- a device changes a setting. The window reads this from the window-only log, as d46888a and f7caeb4 do today;
- **OS-3's flood shut-off fires** (Security's BN-7 addition, relayed by the Chief of Staff). The chip reads `Closed to the internet: too many wrong passcodes` in the warning colour, stays until clicked, and the click opens Activity. **The route is already closed by then, so this one event keeps the chip visible even when no device access is open, until it's clicked.** It is the only event that does. The Settings row keeps saying why the route closed, and that only Bunny's window can reopen it (OS-3, §5.2). Because the shut-off is saved (`shutoffAt`, §4.5), a reload or a restart shows the event again, until the window reopens the route or the chip is clicked. Clicking acknowledges the event; it doesn't reopen anything.

**What the chip does with an event:**
- It **switches to the event's words**: `New: Pixel 8 signed in (internet)`, `Pixel 8 has Everything`, `Reopened to the internet`, or `Pixel 8 changed a setting` (in the warning colour).
- A **count badge** shows when more than one event is waiting.
- Each event is announced **once** through `aria-live="polite"`.
- A short pulse is allowed, but never as the only sign, and none with reduced motion.
- **There is no timer.** The chip goes back to its state words only when it's clicked.
- **A click** opens Settings → the devices list. For a setting change, it opens that device's Activity.
- **Nothing is stored** (BN-4). A reload shows the state words, and Activity keeps the history.

### 7.3 The tray, notifications, and device pages

- **The tray tooltip** mirrors the chip, including the newest event's words: for example "Bunny AI: Open to the internet · New: Pixel 8 signed in".
- **No notification is sent for a sign-in, a grant or a setting change.** The only system notification is the one-time start notification (RS-5). It says access reopened while Bunny may be hidden in the tray, and names the address for the internet route (§4.5).
- **A device's own page shows no notice (BN-9).**
  - At Everything, the red `Everything` chip in the page header stays, and can't be dismissed.
  - At Chats, nothing is shown.
  - Internet and home-network devices are treated the same.
- **The first-sign-in dialog ("What may it do?") stays.** It isn't a banner: it's where Everything is granted with R-DF1's warning, plus the internet sentence for internet devices (§6.1). So do R-DF1's box in Settings and the Give Everything warning.

## 8. Settings and routes

### 8.1 The settings

All of these are window-only (`WINDOW_ONLY_SETTING_KEYS`) **and** in `isDeviceRefused`, since an Everything device counts as the window. That now includes **internet** devices at Everything. **No device can change any of them**, at any level (64374ea, "what these options can't switch off").

| Key | Values | Note |
|---|---|---|
| `internetRoute` | `'funnel'` \| `'https'` | Which route **On** uses. The on-state is saved in `remote-internet.json`, and read back only with `internetStayOpen` (§4.5) |
| `internetStayOpen` | `true` / `false` (default `false`) | **Stay open to the internet after a restart** (OS-8 revised) |
| `keepSignedIn` | `true` / `false` (default `false`) | **Keep devices signed in**, for **both** listeners (OS-5 revised, 705e7cf) |
| `everythingStaysOn` | `true` / `false` (default `false`) | **Everything stays on**, for **both** listeners (OS-7 revised, 705e7cf) |
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
| `reopened-at-start` / `not-reopened` | the time and the pinned name, or the check that failed (§4.5) |
| `level` | `from` and `to`, and why (window grant, window change, idle drop, sign-out), with `via` |
| `option` | which of the three options changed (or the route choice), and to what |
| `signout` | the device, and why (window, all devices, passcode change, option off, route off, shut-off) |
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
5. The three options (§6, §8.1), the hashed session file (§6.2), the internet Everything dialog (§6.1), and `resumeInternet()` with its checks (§4.5).
6. The window: Settings block, the name warning, the chip and the tray, with no banner (§4.2, §7). Built from Design's drawing.
7. Activity entries, then help text and pictures (O7; PICTURE-CHECK once it lands).

**Tests** (fake Tailscale runner; real HTTP to `127.0.0.1`; invented profile; no network, so TEST-DNS's preload is in force):

| Test file | Proves (OS item) |
|---|---|
| `test/open-signin-listener.test.js` | `netServer` binds 127.0.0.1 only. The Funnel and proxy target is its port, never the window's or the LAN's. A LAN cookie is refused on the internet listener, and the other way round. The listener closes on off, on quit and when Funnel's child ends (OS-1). |
| `test/open-signin-headers.test.js` | Funnel: a missing `Tailscale-Funnel-Request` is refused, and a non-loopback peer is refused. `X-Forwarded-For` is ignored while `trustForwardedFor` is false. Own HTTPS: only the named header counts, and `X-Forwarded-For` cannot be chosen. `X-Forwarded-Proto` and `X-Forwarded-Host` never change the pin (OS-2). |
| `test/open-signin-pin.test.js` | Host must equal the pin, and so must `X-Forwarded-Host`. Origin must be `https://<pin>`. Sec-Fetch-Site is checked. **A direct `127.0.0.1` request with Host `127.0.0.1:<port>`, and a DNS-rebinding Host, are refused.** Invalid own-HTTPS names (wildcard, IP, localhost, scheme) are refused when saved (OS-6). |
| `test/open-signin-limits.test.js` | 60 parallel wrong passcodes give at most the allowed 401s, then waits (RA-1 on the internet listener). 10 wrong in 10 minutes pause every new internet sign-in, the wait doubles up to 1 hour, signed-in sessions keep working, **and the LAN listener still signs in**. Reset works from the window only. 100 in 24 hours shut the route off and record it. At most 2 internet scrypts run at once, and a 3rd gets 429 (OS-3). |
| `test/open-signin-passcode.test.js` | Turning on is refused with a passcode under 16. An old N=16384 record is rehashed to N=65536 after one confirmation, and `verifyPasscode` uses the record's own cost. **The scrypt call passes `maxmem`**, so a sign-in at N=65536 does not throw (OS-4). |
| `test/open-signin-cookie.test.js` | The internet listener sets `__Host-bunny_remote; Secure; HttpOnly; SameSite=Strict; Path=/`, with no Domain. The LAN listener keeps today's cookie and flags, with no `Secure`. **With "Keep devices signed in" off**, the internet session ends after 30 minutes idle and after 12 hours even with activity (OS-5). |
| `test/open-signin-keep.test.js` | **With "Keep devices signed in" on:** the cookie has `Max-Age=34560000`, and there is no idle or maximum end. **A restart keeps the session.** The saved file holds **no secret**: it is searched for the raw cookie value, which must not appear, only its SHA-256. The lookup uses `timingSafeEqual`. Each of these ends the session and deletes its hash: sign out, sign out all, a passcode change, the option off (only sessions older than 12 h), the route off, and the shut-off. **Home network (705e7cf):**
- with the option on, a LAN Chats session is still valid after 3 simulated hours, and an Everything session after 45 simulated minutes;
- both survive a restart, with only hashes saved;
- sign out, sign out all, a passcode change, access off, and RS-4's network check failing each end them;
- a session saved under one network is not reopened on another;
- with the option off, today's 2-hour and 30-minute limits hold, and the LAN cookie keeps its name and flags, with only `Max-Age` changing.

The home-network warning sentence shows while the option is on. |
| `test/open-signin-level.test.js` | **The window** raises an internet device to Everything, and the dialog includes the internet sentence, word for word. **A level change from any device** (Chats or Everything, LAN or internet) is refused. An internet device at Everything is refused `/api/remote*`, `/api/engines*`, SEARCH-PC's settings and Open, and the three options. "Everything stays on" off: the device drops to Chats after 30 minutes idle. On: no drop, for internet **and** home-network devices. Each grant and drop is in Activity with `via`. At Chats, an internet device is refused SEARCH-PC's tools and every `REMOTE_TOOLS_DENIED` tool (OS-7 revised). |
| `test/open-signin-reopen.test.js` | With "Stay open" on, a restart reopens only when every §4.5 check passes. **Each failed check keeps the route closed, with its sentence:** no passcode record, an earlier shut-off, Tailscale stopped, a renamed DNS name, Funnel not allowed, an invalid own-HTTPS name. A leftover Funnel on another Bunny port is turned off, and a non-Bunny one is left alone. A good start reopens, the chip shows, and `reopened-at-start` is written. With the option off, nothing reopens (OS-8 revised). |
| `test/funnel.test.js` | The fake runner checks: the absolute path and fixed arguments, and **never `--bg`, `reset`, `login` or `up`**. Each `status --json` state maps to its screen. Off is the targeted `--https=443 off`. **At start, a leftover Funnel pointing at the recorded port is turned off, and one pointing elsewhere is left alone.** The route reopens at start only through §4.5. The child ending closes the listener (OS-8). |
| `test/open-signin-activity.test.js` | Every OS-10 entry is written, with `via: 'internet'`. **No entry holds an address**, even with `trustForwardedFor` on. The name-warning confirmation is recorded (OS-10). |
| e2e `open-signin.spec.js` | Settings: the route choice, the Tailscale states (fake), the name-warning dialog before HTTPS, the own-HTTPS fields and hints. **There is no banner anywhere:** no `#remote-note`, `#device-note` or `#device-notice`, in the window, a browser page or a device page, in any state (BN tests). The chip:
- reads `Open to the internet · N` in the warning colour, with no dismiss;
- for a new sign-in, reads `New: <device> signed in` until clicked, and the click opens the devices list;
- after a reload, shows the state words;
- catches the swap case (a sign-out and a sign-in between two looks) as an event;
- for a raise to Everything, shows the warning colour with the device's name;
- **for the flood shut-off,** shows "Closed to the internet: too many wrong passcodes" in the warning colour **with no access open**, stays through a reload until clicked, opens Activity when clicked, and leaves the route closed. The Settings row says why, and that only the window can reopen it;
- for a setting changed from a device, shows the event, and the click opens Activity. Two changes show a badge of 2;
- with reduced motion, shows no pulse, and `aria-live` still announces once.

**No notification for a sign-in.** A device page shows the Everything chip at Everything and nothing at Chats. Also covered: the three options, and the internet-device Everything dialog with its sentence. Both themes, at phone and desktop widths (O3, O8). |

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

**Owner questions:** none. Decisions 1 and 2 are recorded.

**Security questions:** none open. The scope is answered (705e7cf: both listeners), and so is the chip (08c6789: BN-6 to BN-9).
