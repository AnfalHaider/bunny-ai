# OPEN-SIGNIN details: driving Tailscale Funnel, the "own HTTPS address" route, other routes

Researcher, 2026-11-19. Follows [2026-11-18-open-signin-tunnels.md](2026-11-18-open-signin-tunnels.md). The owner chose Tailscale plus other selectable routes ("yes tailsacle, also add other options the user may select one form settings", relayed by the Chief of Staff).
Official docs and the vendors' own source repositories only. Nothing installed or run on any machine. Doc pages were read through a summarising fetch tool; source files were read directly from GitHub `main` (Tailscale v1.104.7 is the current release tag; the code I read is `main`, so re-check against the shipped tag). Anything I could not confirm is marked UNKNOWN: those need one test on a real Windows machine before building.

## 1. Driving Tailscale Funnel from Bunny on Windows

### 1a. What the owner does once

Sources: https://tailscale.com/kb/1223/funnel , https://tailscale.com/kb/1312/serve , https://tailscale.com/kb/1153/enabling-https , https://tailscale.com/pricing

1. Install Tailscale for Windows and sign in (free "Personal" plan, "Up to 6 users", "Unlimited user devices"; the FAQ says the free plan is "only suitable for non-commercial use"). Install steps and file paths: not in the pages I fetched (https://tailscale.com/kb/1347/installation only links to separate Windows pages): UNKNOWN.
2. Funnel needs v1.38.3 or later, MagicDNS, and HTTPS certificates enabled for the tailnet. "Tailscale Serve requires you to enable HTTPS certificates in your tailnet"; if HTTPS is off, the `tailscale serve` CLI "prompts you through a web consent page to enable it" (Serve page).
3. First `tailscale funnel ...` run "opens a web page where you approve enabling Funnel. After approval, Tailscale creates HTTPS certificates and adds a funnel node attribute to your policy file." The policy entry is `nodeAttrs: [{target: ["autogroup:member"], attr: ["funnel"]}]`, or "Add Funnel to policy" on the admin console's Access controls page; "You must be an Owner, Admin, or Network admin to edit the policy file" (Funnel page). On a personal tailnet the owner is the Owner.
4. Cost of the one-time step: HTTPS certificates are issued by Let's Encrypt and "this includes the fully qualified domain name of your devices" in public Certificate Transparency logs (HTTPS page). Tell the owner to give the PC a neutral device name before turning HTTPS on, because the name becomes public. Tailnet names cannot be changed except between the default and a random one (same page).
5. No router setting. Nothing for visitors to install.

### 1b. Detect, enable, read the URL, disable (commands)

CLI sources: https://tailscale.com/kb/1311/tailscale-funnel , https://tailscale.com/kb/1242/tailscale-serve , https://tailscale.com/kb/1080/cli , and the status type in https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go . Command lines below are the documented forms; exact printed text for the HTTPS case is only partly documented, so Bunny should parse JSON, not prose.

| Step | What Bunny runs | What it reads | Notes |
|---|---|---|---|
| Installed? | `tailscale version` (probe it, never trust a path: rule R1). Fallback: look for `tailscale.exe` in the install folder | exit code, version line (`--json` exists) | Windows default install path: UNKNOWN from docs; ask a test machine (`where tailscale`). Needs v1.38.3+. |
| Signed in and running? | `tailscale status --json` | `BackendState` (an `ipn.State` string, e.g. running or needs login), `AuthURL` (the URL control gives to authorize), `Self.DNSName` (FQDN, ends with a dot), `CertDomains` (names the tailnet may get certificates for), `CurrentTailnet.MagicDNSSuffix` | Field names are from the `ipnstate` source file; the KB page does not list them. If `BackendState` is not running, show "Open Tailscale and sign in" (Bunny never handles the Tailscale login). |
| HTTPS switch on? | same JSON | `CertDomains` non-empty means HTTPS is available for this node (my reading of the field's comment: "the set of DNS names for which the control" server will issue certs); empty or missing means the admin console switch is off | Confirm against a real output: UNKNOWN. |
| Funnel allowed for this node? | same JSON | the `funnel` node attribute appears among the node's capabilities (`tailcfg.NodeAttrFunnel`; `Self` has a capabilities field) | The exact JSON key (`Capabilities`/`CapMap`) I could not confirm: UNKNOWN. Fallback: just run the enable command and read the failure. |
| Enable | `tailscale funnel --bg <target>` where target is the local port or `http://127.0.0.1:<port>` of Bunny's open-access listener. Add `--https=443` (default) or `8443` / `10000` | the "Available on the internet:" block with the public URL (example `https://amelie-workstation.pango-lin.ts.net`) | `--bg` "runs persistently in the background until you turn it off" and "resumes after a reboot or `tailscale down`/`up`" (Funnel and Serve pages). That conflicts with "off again after every restart" (the LAN mode rule): Bunny must turn it off itself when it quits or starts, or run without `--bg` as a child process of Bunny (then it ends with Bunny: "Press Ctrl+C to exit"). The child-process form is the safer default. |
| First-time consent | same command without the switch ready | the CLI "opens a web page" for approval | A hidden child process cannot show a page: run it visibly once, or read the printed URL. How the URL is printed and whether the command blocks: UNKNOWN. |
| Public URL | after enable: `tailscale funnel status --json` (documented flag; note the Serve page warns that `status` and `status --json` "return different information") or build it from `Self.DNSName` (strip the trailing dot) plus `:port` if not 443 | `https://<DNSName>` | Allowed ports: 443, 8443, 10000 only. "A single port can't be used for both Serve and Funnel": the last command decides. DNS for a new name can take up to 10 minutes. |
| Disable | repeat the original command with `off` appended and all original flags (e.g. `tailscale funnel --https=443 off`), or `tailscale funnel reset` | `funnel status` is empty | Prefer the targeted `off`; `reset` "clears the whole configuration" and would remove any Funnel the owner set up for something else. |
| Certificates | automatic (Let's Encrypt, 90 days); `tailscale cert` is not needed for Funnel | | Let's Encrypt rate limit: "waiting 34 hours" if certificates are requested too often. Do not toggle HTTPS repeatedly. |

### 1c. Does Funnel pass the visitor's address? (answers my earlier UNKNOWN)

Source: `addProxyForwardedHeaders` and `addTailscaleIdentityHeaders` in https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go (read on `main`), and https://tailscale.com/kb/1312/serve .

- The reverse proxy Serve and Funnel use **sets** (replaces) these headers on every request it forwards: `X-Forwarded-Host` (the Host the visitor used), `X-Forwarded-Proto: https` when the visitor connection was TLS, and `X-Forwarded-For` (from the connection's source address `SrcAddr`). Because it uses `Header.Set`, a visitor-supplied `X-Forwarded-For` is overwritten, not appended.
- For Funnel requests it also sets `Tailscale-Funnel-Request: ?1`, after deleting any incoming copy (including underscore spellings), so a visitor cannot forge it.
- Identity headers (`Tailscale-User-Login` etc.) are not sent for Funnel: "Funnel traffic, which is publicly available, does not include identity headers" (Serve page; the code returns right after setting `Tailscale-Funnel-Request`).
- **UNKNOWN: whether `X-Forwarded-For` on a Funnel request is the real visitor address or a relay address.** The code takes `SrcAddr` from the Funnel flow, but I did not follow how the Funnel relay supplies it, and the docs do not say. The PROXY protocol option (`--proxy-protocol` on TCP forwarding) is documented to preserve "the original source IP and port", which suggests the address exists; test with a phone on mobile data and log what arrives.
- Rule for Bunny: trust `X-Forwarded-For` only when the TCP peer is `127.0.0.1` **and** `Tailscale-Funnel-Request` is `?1`. Any request reaching the open-access listener without those must fall back to the socket address (which is `127.0.0.1` for everyone behind the proxy, so treat as "unknown client" and use the global limiter below).

### 1d. Host and Origin pinning with Funnel

- Host the visitor's browser sends = the Funnel name (plus `:8443` or `:10000` if not 443). `X-Forwarded-Host` carries the same value. Pin Host to exactly `<DNSName>[:port]` read at enable time; reject IP literals, `localhost`, other names.
- Origin, when sent, must equal `https://<that host>`; Sec-Fetch-Site must be `same-origin` or `none` (as today, but `https`).
- Today's code pins `http://` + the LAN address ([src/server/app.js:3517-3523](../../src/server/app.js) on e9e84fa); the open listener needs a separate pinned value, or a second listener bound to `127.0.0.1` only (so nothing but Tailscale can reach it), keeping the LAN listener as is.
- The Funnel relay terminates nothing: "The Funnel relay server cannot decrypt data sent over this proxy" (Funnel page); Tailscale's local proxy on the owner's PC terminates TLS, then speaks plain HTTP to `127.0.0.1`. So Bunny's listener must be loopback-only.

## 2. "Own HTTPS address" route

For an owner (or a friend running Bunny) who already has a public name and a TLS front door, or wants to use another tunnel.

What Bunny needs from the person:
1. **A public host name** (typed once in Settings), e.g. `bunny.example.com`. Bunny pins Host to exactly this, and Origin to `https://<name>`.
2. **A trusted certificate for that name**, from one of:
   - A reverse proxy on the same PC that gets and renews it: Caddy "provisions and renews certificates automatically", Let's Encrypt or ZeroSSL, needing the name's A/AAAA records to point at the server and ports 80 and 443 reachable (or the DNS challenge, which needs "no open ports" but the DNS provider's credentials). https://caddyserver.com/docs/automatic-https . This needs a port forward, which the owner wanted to avoid, unless the proxy is itself behind a tunnel.
   - A tunnel that already provides HTTPS (Cloudflare named tunnel below, Tailscale Funnel).
   - Certificate and key files Bunny loads itself (`tailscale cert` writes them; Let's Encrypt renews every 90 days; the owner would have to renew). Bunny would need to hot-reload on renewal. Not recommended as a default.
   - Not usable: a self-signed certificate (phones warn; installing a private root on every device is out of scope), and Caddy's local CA, which is only for internal names ("Caddy creates its own certificate authority to sign certificates for these names", same page).
3. **Where the proxy runs.** Same PC, talking to Bunny on `127.0.0.1`. Bunny trusts forwarded headers only from loopback. The proxy must keep the original `Host` header (Caddy does by default; confirm for other proxies).
4. **Which header carries the visitor address.** Per proxy: `X-Forwarded-For` (Caddy, nginx: the proxy appends or sets; the owner must configure it to overwrite, not append, an incoming one: UNKNOWN per product, check the product's docs), or `CF-Connecting-IP` for Cloudflare. Bunny reads exactly one configured header, name chosen in Settings, only from loopback.

Pinning implications (apply to every route): the pinned host is data from Settings, not from the request; reject on any mismatch; cookie flags below; a second listener on `127.0.0.1` only, with the public checks, separate from the LAN listener; no wildcard hosts.

## 3. Other routes: which stay free and pass Security's rough list

Security's list: a non-IP try limit, Host and Origin pin, `Secure` `__Host-` cookies, a passcode of 16 or more.

- **`__Host-` cookie:** MDN: it "must be set with the `Secure` attribute by a secure page (HTTPS)", must not have a `Domain` attribute, and `Path` must be `/`; example `Set-Cookie: __Host-ID=123; Secure; Path=/`. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie . Browsers that do not support prefixes accept the cookie anyway ("prefixed cookies will always be accepted"), so keep the server-side checks. **A `Secure` cookie is not stored over plain `http://`, so the LAN mode over HTTP must keep today's cookie name; use `__Host-bunny_remote` only on the HTTPS listener** (this may also be the cause of the installed-web-app sign-in failure being fixed in v0.1.14; Security's call).
- **Non-IP try limit:** not researched from vendor docs (it is Bunny's own design). Observation: behind any tunnel the socket address is `127.0.0.1` for every visitor, so a per-IP counter cannot tell visitors apart unless the forwarded-header rules above hold. A global counter (for example N wrong passcodes per hour from anyone, then a growing wait) works without any address but lets an attacker lock the owner out; keep already-signed-in sessions unaffected and let the owner reset it from the PC's own window.
- **Passcode of 16 or more:** Bunny's own rule (the generated one is 20 characters from a 32-letter alphabet, 100 bits: [src/server/remoteAccess.js:21-24](../../src/server/remoteAccess.js)); scrypt cost is `N=16384`, which is low for internet exposure: Security's call.

Routes, status for this list:

| Route | Free (R4) | Passes the list? | Notes |
|---|---|---|---|
| Tailscale Funnel | free Personal plan; breaks if Funnel leaves it | Yes, once the XFF question is tested | Chosen. |
| Own HTTPS address (owner's proxy or domain) | Bunny's part is free; the owner's domain/DNS may cost | Yes, with the proxy configured to overwrite the forwarded-address header | Selectable. |
| Cloudflare named tunnel | Needs a domain on Cloudflare (a paid thing unless the owner owns one); Tunnel price not stated on the pages I read | Header: `CF-Connecting-IP` "provides the client IP address connecting to Cloudflare to the origin web server"; Cloudflare's `X-Forwarded-For` is appended, so do not trust it; `X-Forwarded-Proto`: "If the client set a different value, it will be overwritten". https://developers.cloudflare.com/fundamentals/reference/http-headers/ . Whether a visitor can forge `CF-Connecting-IP`: the page does not say: UNKNOWN. SSE through a named tunnel: not stated (the quick-tunnel page says SSE is unsupported): UNKNOWN. | A variant of "own HTTPS address" for owners who already have a domain; `cloudflared` is Apache-2.0 (https://github.com/cloudflare/cloudflared). |
| Cloudflare quick tunnel | Free, no account | **No**: SSE is not supported (chat streaming breaks), and the address changes every start | Do not offer. |
| ngrok free | Quotas (1 GB, 20,000 requests a month) fail R4 | Interstitial page for browsers | Do not offer. |
| Self-signed + router port forward | Free | Port forward is what the owner wanted to avoid; certificate warnings | Do not offer. |
| Other free tunnel services (SSH-based or self-hosted) | Not researched: I read no official source for any, and they come and go | Not assessed | Do not claim; if the owner names one, research it as its own item. |

So the honest answer to "any other route that stays free and passes Security's list" is: **no other zero-account, zero-domain route exists among the ones I could source.** The selectable list that Settings can offer is Tailscale Funnel, own HTTPS address (which also covers Cloudflare named tunnel, Caddy and others), and Off.

## 4. Tests needed before building (one Windows machine, owner's Tailscale)

1. `where tailscale`, `tailscale version --json`, `tailscale status --json` before and after sign-in and before and after HTTPS is enabled (record `BackendState`, `CertDomains`, `Self` capability key, `AuthURL`).
2. `tailscale funnel --bg 3000` and the child-process form: what it prints, whether it blocks, and what happens on first-time consent when no console is attached.
3. From a phone on mobile data: the headers that arrive (`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `Tailscale-Funnel-Request`) and whether `X-Forwarded-For` is the phone's public address.
4. SSE chat streaming through Funnel (the relay and bandwidth limits).
5. `tailscale funnel ... off` and `status --json` after, and a reboot with and without `--bg`.

## Not verified

The Windows install path; the exact JSON key for node capabilities; the printed output for the HTTPS Funnel case; whether Funnel's `X-Forwarded-For` is the real visitor address; Cloudflare Tunnel price and SSE on a named tunnel; whether `CF-Connecting-IP` can be forged; any non-sourced tunnel service. Source code was read from GitHub `main`, not from the v1.104.7 tag.
