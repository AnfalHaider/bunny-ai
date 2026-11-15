---
piece: g-1
role: tech-lead
sha: 09b35e4
verdict: FAIL
date: 2026-11-15
---

Strong work: 97 adversarial cases, 87 as expected. Required before PASS: (1) the attached short form of the git config override (-c immediately followed by the key, no space) is allowed and skips hooks; (2) git push with --all, --mirror or a wildcard refspec is allowed for non-live roles; (3) a gitattributes entry so the hooks are LF and the A1 hook test passes on this machine, and the executable bit noted for landing. Decisions: require sub-command to chief-of-staff and security only; push exempt list confirmed. Variable write targets pass: document as a limit.
