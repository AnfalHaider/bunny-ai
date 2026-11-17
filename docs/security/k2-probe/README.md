# K-2 probes (Security, 2026-11-17)

Run `node <file> <checkout>` (w51d.mjs reads the checkout from env `KCO`). Each sets `KIT_NEXT=1` itself, except `k15b.mjs` and `w51d.mjs`/`w51f.mjs`, which need `KIT_NEXT=1` in the environment: without it `test/guard-helpers.js` falls back to the repository's own `.bootstrap/bin` (the 0.6.0 guard, no deadline) and the numbers are wrong (this caused my wrong FAIL at ec605fd/bec112e).

- `k1wt2.mjs`, `k1wt3.mjs`: worktree escapes (old-history worktree, planted git dir), absolute writes into the main checkout, pre-push from three places.
- `k2more.mjs`: K2-4 (repository outside the project, planted `commondir`), writes inside `.git`, `git worktree` subcommands, `git clone`/`git init`.
- `k15b.mjs <checkout> "<part>"`: K1-5, N chained parts through the real `guard.mjs`; expect exit 2 within about 6.3 s.
- `w51d.mjs`, `w51f.mjs`: W5-1d credential printing and the notes/for/releases/tag/live-case refs.
