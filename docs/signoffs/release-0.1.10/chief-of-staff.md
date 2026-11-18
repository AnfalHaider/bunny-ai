---
piece: release-0.1.10
role: chief-of-staff
sha: 975970a
verdict: PASS
date: 2026-11-18
---

Chief of Staff, 2026-11-18. v0.1.10 is main d183f9c plus these rows, each built and reviewed tonight:

- SETTINGS-BRIDGE;
- SB-1 with SB1-a, and SB-2;
- QA-ANSWERS, with the text-only LOW;
- MODEL-CHIP;
- GAPS-QA and RUN;
- W2-9, with W29-1 and W29-2 and every git hardening up to 4f63b27;
- W6-11 and its LOWs;
- S-3 and S-5..S-7;
- BROWSER steps 1 and 2, with full chats from devices, R1-R9, the device tool allow-list, Design's locks, RA-1, and QA's F-1/F-2;
- the minimatch audit exceptions (the owner's "Proceed with recommendation.");
- the version, 0.1.10.

Out of this release: K-5. Security ran it, 14 of 16 files pass and guard-next-a2 still has 1 failure to name; it goes to the next release.

Evidence:

- Gate 9/9 at 975970a (docs/releases/evidence/2026-11-18-v0-1-10-gate-975970a.md).
- QA, Security, Tech Lead, Design and the Librarian all PASS at 975970a.
- Every per-piece sign-off is an ancestor (Security's release check matched patch ids).

Not tested for real:

- the Ctrl+Alt+Space key;
- a real Windows firewall prompt and a real LAN address (tests used 127.0.0.2);
- a real 0.1.9 to 0.1.10 update on an installed copy (QA's post-release walk).
