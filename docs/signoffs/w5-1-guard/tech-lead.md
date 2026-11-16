---
piece: w5-1-guard
role: tech-lead
sha: 611dee7
verdict: FAIL
date: 2026-11-16
---

Delta review of d3ee1cf..611dee7 (W5-1b). Unit suite at 611dee7: 611 pass, 0 fail; I ran the guard against 34 commands as a builder. G1-6 holds: tags (--tags, refs/tags, short names looked up), bare-URL and folder pushes, --repo=URL, remote add and set-url, branch -f, -fd and --move on the live branch, checkout-index --all and --prefix, update-ref, and gh allowlist denials (workflow run, pr create off a claude/* branch) are refused; named branch pushes and gh reads still pass. chat.js: the slow stream sits inside fakeStream, which streamChat reaches only with fake=true (BUNNY_FAKE_UPSTREAM=1 or a test), so real providers are untouched. One defect, required: gh auth status --show-token and -t are allowed (group auth, sub status returns null) and print the sign-in token into the session transcript, which AGENTS.md says must never leave the machine and which the gh auth rule is there to prevent. Fix: for gh auth status refuse -t and any unique prefix of --show-token, with a test; also refuse gh auth status with a variable argument. Minor, not blocking: gh run download and gh release download write into the working folder (paths not judged); git symbolic-ref HEAD to the live branch is allowed, so a later commit would move the local live label (push still refused); git remote rename is allowed. Landing: hooks check compares real paths against this checkout's and the main checkout's .githooks, which matches the current setting. e2e not run by me.
