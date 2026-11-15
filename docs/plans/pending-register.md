# Pending register

<!-- Owned by the Librarian. Nothing leaves this file except as DONE with a sha, or a dated owner decision. -->

## Waiting on the owner

- **Q1 (board, 2026-11-12) — answered by research, awaiting owner's acknowledgement.** The premise is out of date: the two open parity rows (6.7 Computer use, 6.10 Plugins and marketplaces) are marked done in `docs/features.js:111,114`. Not closed by the Librarian; the owner closes it. Owner's answer: _pending_.
- **Guard gaps (HIGH, security control, 2026-11-16)** — (1) shell writes are not checked against `write_globs`; (2) cross-drive paths are treated as inside the repo. Needs a Tech Lead spec first, then the owner's go before any change. Owner's answer: _pending_.
- **Retroactive release records for 0.1.2–0.1.4 (2026-11-16)** — Are they wanted? Recommendation: no. The Librarian will not invent the owner's words for them. Owner's answer: _pending_.

## Waiting on a session

- **S-1 (HIGH, local API accepts requests from any web page on this PC, 2026-11-16)** — Owner's go given (AGENTS.md "S-1 go", 268f47d). Sequence: Tech Lead specs the fix, Builder builds it, QA and Security sign off. Status: _spec not yet started_.
- **Builder B-1 (2026-11-16)** — Fix shell quoting in `scripts/bootstrap.mjs`. The `build-css` step fails because the Node path `C:\Program Files\nodejs` contains a space and is run unquoted (the repo path is fine). Needed before the gate runs. Owner session: Builder. Status: _not yet claimed_.

## Promised and not delivered

<!-- Nothing recorded yet. -->
