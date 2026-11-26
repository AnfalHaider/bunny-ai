---
piece: v0116-websearch
role: security
sha: ae59e19b
verdict: PASS
date: 2026-11-26
---

Reviewed ed2e7816 then a1d53c4a and ae59e19b. WS-1 fixed: the Settings help says the search words go to the sites one after another until one answers. WS-2: okLink drops links into bing.com, localhost, .local, .internal, name-less hosts and private or loopback IPs, after the Bing redirect is decoded too; read_url stays behind fetchLimited (public only, every redirect checked). WS-3: a snippet that is a bare address gets a leading mark; my probe of a title carrying a newline plus an address shows it collapsed onto the title line, so no forged link line. WS-4: the memory prunes entries older than 2 minutes on every write and keeps at most 50. Hosts are constants, an answer from another host is not read, a keyed Brave answer is never kept, the key is redacted, the cookie only sets language and market. Ran in an invented profile: web-search-f6 and install-anywhere, 44 pass, 0 fail. A Settings switch to turn off the Bing and Wikipedia backups is not required for this update: the help now names every site and says the words go to each in turn; it can come later.
