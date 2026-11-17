---
piece: w6-9
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W6-9 at 304e71a, e2e/w6-tools-walk.mjs rows W69. read_file on a folder lists it (200 lines at most); on the parent or an absolute outside folder it is refused. read_url on a file address inside the workspace reads a file or lists a folder; a file outside, a share on another computer, a UNC path, a climbing path, a device path and the parent folder are refused with no file text; a junction inside the folder that points outside is not followed by read_url or read_file; a deny rule on secrets/* stops the file address and another file still reads.
