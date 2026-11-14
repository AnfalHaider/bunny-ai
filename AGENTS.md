# AGENTS.md — standing rules

<!-- Written by bootstrap-environment. Edited only by the Chief of Staff, on the owner's typed word.
     Every rule keeps its reason: a rule without its reason gets argued away. Fill every <…>. -->

## Boundaries (owner's answers, Phase 0H — dated)

| Question | Answer | Date |
|---|---|---|
| Live branch / dev branch | `<main>` / `<dev>` | |
| What moves live, and from whom | the owner's "release <scope>" (or "apply" for Hotfix), typed in that session's chat or relayed under 7E | |
| REAL databases, folders, services | <name each> — everything else must be provably a copy | |
| Must never leave this machine | <data, keys, screenshots of real data> | |
| Upstream / sibling projects never written to | <name; push URL disabled> | |
| Routine-looking destructive commands | <e.g. a test runner that resets the DB> — also in `.bootstrap/policy.json` | |
| Who runs server commands | the owner, after each line is reported with its exact text | |
| The gate (one command) | `<scripts/gate>` | |
| Invented-data copy for screenshots/tests | <where> | |

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
| chief-of-staff | | |
| librarian | | |
| researcher | | |
| design | | |
| builder | | |
| qa | | |
| tech-lead | | |
| security | | |
| release-ops | | |
| hotfix (cloud) | | |
| platform (on demand) | | |
| support (on demand) | | |
| <project lanes> | | |

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
