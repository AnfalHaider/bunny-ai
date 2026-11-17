# Pending register

<!-- Owned by the Librarian. Nothing leaves this file except as DONE with a sha, or a dated owner decision. -->

<!-- Reconciled 2026-11-18 against origin/main (d183f9c, merged into claude/librarian-v018-status). Checked by reading git history and code; no gate or live probe run. -->

## Waiting on the owner

- **Q1 (board, 2026-11-12) — answered by research, awaiting owner's acknowledgement.** The premise is out of date: the two open parity rows (6.7 Computer use, 6.10 Plugins and marketplaces) are marked done in `docs/features.js:111,114` (rechecked on main, 2026-11-18). Not closed by the Librarian; the owner closes it. Owner's answer: _pending_.
- **Guard gaps (HIGH, security control, 2026-11-16)** — (1) STILL OPEN: shell writes are not checked against `write_globs`. `write_globs` is read in `.bootstrap/bin/lib/flow.mjs`, `lib/policy.mjs` and `precommit.mjs`, not in `lib/shellrules.mjs` or `guard.mjs` (checked 2026-11-18). (2) STILL OPEN: cross-drive paths are treated as inside the repo; no drive-letter check found in `lib/shellrules.mjs` or `guard.mjs`. Needs a Tech Lead spec first, then the owner's go before any change. Owner's answer: _pending_.
- **Retroactive release records for 0.1.2–0.1.4 (2026-11-16)** — Are they wanted? Recommendation: no. The Librarian will not invent the owner's words for them. Owner's answer: _pending_.
- **B-1 approval (2026-11-16)** — B-1 (`scripts/bootstrap.mjs` shell-quoting fix, 332f44a, on main) has Tech Lead's PASS (242ef8c). The owner's approval, in Tech Lead's chat, is not recorded. Owner's answer: _pending_.

## Waiting on a session

- **S-1 (HIGH, local API accepts requests from any web page on this PC, 2026-11-16)** — Owner's go given (AGENTS.md "S-1 go", 268f47d). Built at `ca01243` and on main: `src/server/requestGuard.js:75` checks Origin against Host. Security PASS recorded at the 0.1.5 scope (0ba80ba). **Still needed:** QA sign-off, not evidenced by the Librarian.
- **D1 (design review 0.1.4) — built at `2cfeec5`, on main** (checked 2026-11-18). Librarian "lessons applied" sign-off written, PASS at `2cfeec5`. **Still needed:** QA and Design sign-offs, not evidenced by the Librarian.
- **Builder B-1 (2026-11-16)** — Fix shell quoting in `scripts/bootstrap.mjs`, built at `332f44a`, on main (`scripts/bootstrap.mjs:15`). Librarian sign-off recorded (PASS at `332f44a`, committed by the Chief of Staff in `9aa561c`). Tech Lead PASS at `332f44a` (242ef8c). **Still needed:** the owner's approval, in Tech Lead's chat.

## Recorded decisions and deliveries

- **Tonight's delegation and standing order** — AGENTS.md at `190ab86` ("Delegation row: push to main only"). The owner's exact words are not held by the Librarian; the Chief of Staff supplies them.
- **Researcher tool inventory** — `37749ef` (R-2: Claude Code and Cursor vs Bunny AI, with gaps and priorities).
- **Design D-2 decisions** — taken by the Chief of Staff. Owner's words not held by the Librarian; the Chief of Staff supplies them.
- **Audit exception picomatch (GHSA-fc5q-39xc-vjpf)** — signed by the owner, 2026-11-18 ("Sign the exception"), recorded in `docs/security/audit-exceptions.json` (1dad4ac). Review by 2026-12-17. Covers one advisory only; see BOARD S-8.

- **Code signing (S-2b, 2026-11-18)** — Owner, typed in the Chief of Staff's chat on 2026-11-18: "We are not signing the code." The installer stays unsigned, and the release notes keep the SmartScreen line. Recorded in `docs/plans/2026-11-18-v0.1.10-plan.md:61` (origin/main). Closed; no code change.

## Promised and not delivered

<!-- Nothing recorded yet. -->
