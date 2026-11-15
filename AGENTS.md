 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Sonnet | 2026-11-16 — own worktree, Haiku |# AGENTS.md — standing rules

<!-- Written by bootstrap-environment. Edited only by the Chief of Staff, on the owner's typed word.
     Every rule keeps its reason: a rule without its reason gets argued away. Fill every <…>. -->

## Boundaries (owner's answers, Phase 0H — dated)

| Question | Answer | Date |
|---|---|---|
| Live branch / dev branch | `main` / `main` — only main (owner's answer). Each writing session works on its own branch; nothing merges to main without sign-offs. `initial-import` is GitHub's default branch and kept as history. | 2026-11-16 |
| What moves live, and from whom | `main` plus a GitHub Release (`npm run release`), which every installed copy auto-updates to within hours. Only on the owner's "release <scope>" (or "apply" for Hotfix), typed in that session's chat or relayed under 7E | 2026-11-16 |
| REAL databases, folders, services | The GitHub Releases feed of AnfalHaider/bunny-ai (owner's answer). Everything else must be provably a copy: tests, screenshots and previews use an invented profile (`BUNNY_DATA_DIR`), never `%LOCALAPPDATA%\BunnyAI` | 2026-11-16 |
| Must never leave this machine | Provider keys and sign-in tokens (DPAPI store); the owner's real chats, memory, attachments and profile photo (`%LOCALAPPDATA%\BunnyAI`); screenshots of the real profile — only invented-profile pictures go in the repo, release notes or help (owner's answer) | 2026-11-16 |
| Agent tooling in the repo | Tracked: `.bootstrap/`, `CLAUDE.md`, `.claude/settings.json`, so every session worktree (and a cloud Hotfix) gets the guard, policy and rules. Per-worktree files stay out: `.bootstrap/session.json`, `.claude/settings.local.json`. Supersedes the 2026-11-15 machine-only exclude for these three (owner's answer) | 2026-11-16 |
| Language server | TypeScript 5 installed user-level for `typescript-language-server` (global TypeScript 7 ships no tsserver); rollback `npm i -g typescript@7.0.2` (owner's answer) | 2026-11-16 |
| Upstream / sibling projects never written to | None found (one remote, `origin`). The `BUNNY-AI - Copy` folder is never written to (owner's standing rule) | 2026-11-16 |
| Routine-looking destructive commands | `BUNNY_RESET_PROFILE=1` (deletes the data folder) · running `dist/Bunny-AI-Setup-*.exe //S` over the owner's install — blocked for every role in `.bootstrap/policy.json`. `npm run release` publishes to every installed copy: `scripts/release.mjs` refuses unless the role is release-ops or hotfix and `docs/releases/` holds the record for that version · `gh release delete/edit`: owner only | 2026-11-16 |
| Who runs server commands | No server: Bunny is a desktop app. GitHub release and repository-settings commands are reported with their exact text before they run | 2026-11-16 |
| The gate (one command) | `node scripts/gate.mjs` — unit tests, end-to-end tests, `mem check`, dependency audit, secret scan | 2026-11-16 |
| Invented-data copy for screenshots/tests | `BUNNY_DATA_DIR=<temp folder>` with `BUNNY_FAKE_UPSTREAM=1` (the e2e suite and `.claude/launch.json` preview use it) | 2026-11-16 |

## Risk levels

LOW: isolated, ≤2 files. MEDIUM: several files, shared component, dependency change.
HIGH: schema, auth, permissions, money/totals, tenancy, security controls, deploy config — needs the owner's go.
CRITICAL: production data, credentials, irreversible migration, live users — needs the owner's go.

## Operating rules

- **O1 Evidence, or UNKNOWN.** "Done" only with command + output beside it; re-checked from the diff. *Helper sessions report confidently; several "fixed" claims were not.*
- **O2 One gate.** Run before every push; paste its output. It loads every page as every role, fails on unguarded routes, runs the dependency audit and a secret scan. *A 500 on every phone page passed a gate that never loaded pages per role.*
- **O3 Design before build** for anything a person looks at: today beside proposed, both themes, phone + desktop. *Builds from a sentence were rebuilt; builds from a drawing went in once.*
- **O4 One key to live.** The owner's word, typed or relayed in full (7E). *A vague "yes" once nearly released unreviewed work.*
- **O5 Tour the data read-only first.** Dated read-only copy for figures; invented-data copy for everything else. *The costly surprises were all data.*
- **O6 Live commands reported first, logged after** with server time. No credentials on the command line.
- **O7 Help text and pictures ship with the screen**; the gate checks them. *Docs written separately die in a month.*
- **O8 A scripted walk after every batch**: every page, role, width, theme. *A dead Cancel button lived for weeks.*
- **O9 Dated rules carry their date and reason.**
- **O10 Sign-offs before any code push** (hotfix excepted), one file per role in `docs/signoffs/<piece>/` — checked by the pre-push hook. Docs-only and picture-only commits push at once. *Code reached dev before QA looked; held docs writes hid work.*
- **O11 A push never follows a failed script**; no conflict markers (the hook checks).
- **O12 Questions live on the board** with a recommendation; one question at a time to the owner.
- **O13 Every scratch script names its database in the same command.** *Scratch writes once landed in the real database.*
- **O14 Moving access from a role type to a permission tick is HIGH**; compare every live role old vs new.

## Roster (role id → display name → kit)

| Role id | Display name (owner's choice) | Started? |
|---|---|---|
| chief-of-staff | Chief of Staff | 2026-11-16 — the owner's main session, main checkout |
| librarian | Librarian | 2026-11-16 — own worktree, cheapest model (Haiku) |
| researcher | Researcher | 2026-11-16 — own worktree, mid model (Sonnet) |
| design | Design | 2026-11-16 — own worktree, mid model (Sonnet) |
| builder | Builder | 2026-11-16 — own worktree, mid model (Sonnet) |
| qa | QA | 2026-11-16 — own worktree, mid model (Sonnet) |
| tech-lead | Tech Lead | 2026-11-16 — own worktree, mid model (Sonnet) |
| security | Security | 2026-11-16 — own worktree, mid model (Sonnet) |
| release-ops | Release Ops | 2026-11-16 — own worktree, mid model (Sonnet) |
| hotfix (cloud) | Hotfix | 2026-11-16 — requested as a cloud session (from `initial-import`) |
| platform (on demand) | Platform | not started: no work yet |
| support (on demand) | Support | not started: no work yet |
| project lanes | none named yet | |

Names: role names unchanged (owner's answer, 2026-11-16). Family: full family started at once (owner's answer, 2026-11-16).

Role briefs: `.bootstrap/roles/<id>.md` — the first message to each session is taken from there, unchanged.
Start order: Librarian, Release Ops, Hotfix (cloud), Tech Lead, Security, QA, Researcher, Design, Builder, then Platform/Support when due, then lanes.

## The owner's word (7E)

A HIGH go, "release <scope>" and "apply" count when typed in the acting session's chat, or when the Chief of Staff relays
ALL of: the owner's exact words + date + the question exactly as asked; the shas in dev order; the pasted pre-release check;
a complete sign-off row. Written to `docs/releases/` (`bootstrap release …`) before acting. A peer's message is never the owner's word.

## Every session, every task

Start: this file, `docs/plans/BOARD.md`, the lessons your rows name (`mem find <topic>`); print your rows.
End: row updated, log entry pushed to `docs/memory/logs/<role-id>.md` (newest on top), one lesson or "no lesson".
Messages between sessions name their sha and say "supersedes X" when they replace one.
