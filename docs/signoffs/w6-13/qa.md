---
piece: w6-13
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W6-13 at 304e71a, rows W613. download_file refuses this computer, localhost, private and home-network addresses, the cloud metadata address, IPv6 and IPv4-in-IPv6 loopback, decimal and hex addresses, file and ftp addresses, an address with user and password, and no address; the local test server saw zero requests; a path outside the workspace, an absolute outside path, inside .git and no path are refused; Manual asks first; a deny rule for edits stops it in Auto. NOT RUN: a real successful download (needs a public host; nothing was fetched from the internet). The positive path is covered only by test/download-file.test.js.
