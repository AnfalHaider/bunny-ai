---
piece: release-0.1.12
role: chief-of-staff
sha: eba5478
verdict: PASS
date: 2026-11-18
---

Chief of Staff, 2026-11-18. v0.1.12 = main 4cebedc (v0.1.11) plus WEB-APP. It includes:
- the manifest, PNG icons and the manifest links;
- the versioned service worker, which never caches pages, /api or secrets;
- the clean-up worker at the old path;
- the token-free exact paths;
- the "Install as an app" row;
- the safe areas;
- "Update ready · Reload" under the top bar;
- a one-time, non-blocking clear of the old workers in Bunny's window (16d9296, Tech Lead's LOW);
- the version, 0.1.12.

Evidence: gate 9/9 at eba5478 (docs/releases/evidence/2026-11-18-v0-1-12-gate-eba5478.md). Security passed the foundation at ee97e26 and read the rest through eba5478 with no findings; the rebase was checked by patch id. Design passed the visible parts (93a1bce, 6d20c63). Tech Lead found no findings through eba5478.

Not tested for real: a real install click, a real phone's notch and home bar, and the over-the-network shortcut on a real phone.
