# Pending register

<!-- Owned by the Librarian. Nothing leaves this file except as DONE with a sha, or a dated owner decision. -->

## Waiting on the owner

- **Q1 (board, 2026-11-12) — answered by research, awaiting owner's acknowledgement.** The premise is out of date: the two open parity rows (6.7 Computer use, 6.10 Plugins and marketplaces) are marked done in `docs/features.js:111,114`. Not closed by the Librarian; the owner closes it. Owner's answer: _pending_.
- **Guard gaps (HIGH, security control, 2026-11-16)** — (1) shell writes are not checked against `write_globs`; (2) cross-drive paths are treated as inside the repo. Needs a Tech Lead spec first, then the owner's go before any change. Owner's answer: _pending_.
- **Retroactive release records for 0.1.2–0.1.4 (2026-11-16)** — Are they wanted? Recommendation: no. The Librarian will not invent the owner's words for them. Owner's answer: _pending_.
- **B-1 approval (2026-11-16)** — B-1 (`scripts/bootstrap.mjs` shell-quoting fix, 332f44a) waits for Tech Lead's sign-off. The owner approves it in Tech Lead's chat. Owner's answer: _pending_.

## Waiting on a session

- **S-1 (HIGH, local API accepts requests from any web page on this PC, 2026-11-16)** — Owner's go given (AGENTS.md "S-1 go", 268f47d). Built at `ca01243` (Builder, branch `claude/builder-efa9a9`): Host and Origin checks, a per-launch token, and export from memory. Librarian "lessons applied" sign-off written, PASS at `ca01243` (`docs/signoffs/s-1/librarian.md`). **Still needed:** QA and Security sign-offs.
- **D1 (design review 0.1.4) — built at `2cfeec5`** (Builder, branch `claude/builder-efa9a9`). Librarian "lessons applied" sign-off written, PASS at `2cfeec5` (`docs/signoffs/d1/librarian.md`). **Still needed:** QA and Design sign-offs; the browser run is not evidenced by the Librarian.
- **Builder B-1 (2026-11-16)** — Fix shell quoting in `scripts/bootstrap.mjs`, built at `332f44a`. Needed before the gate runs. Librarian sign-off recorded (PASS at `332f44a`, committed by the Chief of Staff in `9aa561c`). **Still needed:** Tech Lead sign-off, then the owner's approval in Tech Lead's chat.

## Recorded decisions and deliveries

- **Tonight's delegation and standing order** — AGENTS.md at `190ab86` ("Delegation row: push to main only"). The owner's exact words are not held by the Librarian; the Chief of Staff supplies them.
- **Researcher tool inventory** — `37749ef` (R-2: Claude Code and Cursor vs Bunny AI, with gaps and priorities).
- **Design D-2 decisions** — taken by the Chief of Staff. Owner's words not held by the Librarian; the Chief of Staff supplies them.

## Promised and not delivered

<!-- Nothing recorded yet. -->
