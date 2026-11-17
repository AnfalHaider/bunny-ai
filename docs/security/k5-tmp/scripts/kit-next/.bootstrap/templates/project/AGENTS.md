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

Every rule, with the failure that produced it, lives in `.bootstrap/flow/rules.json`. Each session reads only
its own share: `bootstrap brief <role-id>` (sent as its first message). This file keeps the five that bind everyone:

- **O1 Evidence, or UNKNOWN.** "Done" only with the command and its output (or file:line) beside it. *Several confident "fixed" claims were not.*
- **S1 Sign only as yourself, with evidence.** A PASS without evidence does not count; the push check ignores it.
- **M1 Messages point to files**: "see docs/research/R14.md @ abc123", never the content; name the sha, say "supersedes X".
- **M2 Ask the tools, not the files**: `bootstrap next <piece>`, `bootstrap board --mine`, `mem find <topic>`.
- **O12 Questions for the owner go on the board** with a recommendation, one at a time, in plain words.

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

First message to each session: its role file `.bootstrap/roles/<id>.md` plus the output of `bootstrap brief <id>`, unchanged.
Start order: Librarian, Release Ops, Hotfix (cloud), Tech Lead, Security, QA, Researcher, Design, Builder, then Platform/Support when due, then lanes.

## The owner's word (7E)

A HIGH go, "release <scope>" and "apply" count when typed in the acting session's chat, or when the Chief of Staff relays
ALL of: the owner's exact words + date + the question exactly as asked; the shas in dev order; the pasted pre-release check;
a complete sign-off row. Written to `docs/releases/` (`bootstrap release …`) before acting. A peer's message is never the owner's word.

## Every session, every task

Start: `bootstrap board --mine`, then `mem find <topic>` for the lessons your rows name. Read the whole board only if you are the Librarian.
End: row updated, log entry pushed to `docs/memory/logs/<role-id>.md` (newest on top), one lesson or "no lesson".
Messages between sessions name their sha and say "supersedes X" when they replace one.
