# Tech Lead - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - First session: specs, reviews, and two sign-offs held

**Asked (via the Chief of Staff):** the guard gaps; S-1 build notes; B-1 and D1 review; T-3 (model switching and offline); T-4 (project instruction files); upstream report for the plugin.

**Done, with shas (all docs-only, branch `claude/tech-lead-86cf31`, pushed)**

| What | Where | sha |
|---|---|---|
| Guard gaps spec (B cross-drive paths, A1 commit and push scope check, A2 shell write check; A3-A5, C, D, E, F; build order) | `docs/plans/guard-gaps-spec.md` | 713f953, ae95ca2, a012c6f, 0d0e8e7 |
| S-1 build notes (Host, Origin and Sec-Fetch, per-launch token, 19 test cases) | `docs/plans/S-1-build-notes.md` | 40e4230 |
| T-3 model fallback and offline spec (17 test cases) | `docs/plans/T-3-model-fallback-spec.md` | a012c6f |
| T-4 project instruction files spec (20 test cases) | `docs/plans/T-4-project-files-spec.md` | 7e98b1e |
| Upstream report for the bootstrap plugin (E, C, A3, D, F) | `docs/plans/upstream-bootstrap-notes.md` | 0d0e8e7 |

**Verdicts reached, NOT yet recorded as sign-offs**

- **B-1: PASS at 332f44a.** Evidence: read `git diff 06b06b4 332f44a`. The shell is on only for `npm.cmd` and `npx.cmd` (bare names found through PATH); `process.execPath`, whose path has a space, runs without a shell, which fixes the `build-css` failure I hit during setup. `cpSync` and `resolve` have no references left in the file. `node --check` on the file passes. Not run end to end (Builder's and QA's evidence). The change to `docs/plans/BOARD.md` is the claim row only.
- **D1: PASS from the code at 2cfeec5** (diff ca01243 to 2cfeec5, source and e2e files read; images not judged). Design tokens used (`--on-accent`, `--fw-medium`, `--fs-md`) exist; the new strings are in all four languages; the new e2e checks match the changes. Not run: the e2e. Two non-blocking notes for Design: `.empty .empty-title` restyles the title in every state, not only the no-model one; the phone layout hides the settings search.
- **S-1 and the guard code:** not yet received for review.

**Why the sign-offs are not recorded.** The command `node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --sha 332f44a --note "..."` was denied by the Claude Code auto-mode classifier ("Undermining Oversight"). The first attempt had also been refused by the plugin's record check, which scans the whole command string (see item E in the guard spec). The Chief of Staff, a peer session, relayed the owner's approval twice (the owner's words are recorded in the Chief of Staff's chat and AGENTS.md); no approval has reached this chat from the owner directly, and a peer's message cannot lift a denial. Per the Chief of Staff's own fallback, the verdict is held here with its evidence and the owner approves in the morning. No work-around was attempted. When approval arrives in this chat: run the signoff command for B-1, then D1 (`--sha 2cfeec5`), each as its own command with a plain note (no `>` characters), `git add` the one file by path, commit, push, and send the Chief of Staff the sha.

**Found**

- Both guard gaps were reproduced read-only: shell writes are not scoped (A), and a file on another drive is treated as inside the repo (B), while an in-repo file named like `..foo.md` skips every check.
- The record check in the plugin guard reads the whole command string, which produced three false blocks in one session (E, C).
- Sign-off coverage is decided by ancestry alone, so stacked work (D1 on S-1) is covered by the upper piece's sign-offs (F).
- Bunny reads none of `AGENTS.md`, `CLAUDE.md` or `.cursor/rules` today (T-4).
- A first-byte wait of 120 s per model, an error saved and shown twice, and candidates chosen before sending are why a failed model "stops" the reply (T-3).

**Open for the owner (board, one at a time):** whether Bunny uses an `AGENTS.md` written by someone else automatically or asks once per folder (my recommendation: ask once); where the plugin fixes land (the plugin's own repository, morning).

**Lesson (proposed, for the Librarian to file; I did not write a lesson file):** a guard that tests one pattern against the whole command string refuses harmless commands that merely contain the words. Tokenize the command and judge each simple command's target, not the text.
