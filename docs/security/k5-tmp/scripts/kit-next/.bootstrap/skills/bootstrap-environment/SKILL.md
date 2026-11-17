---
name: bootstrap-environment
description: Set up any project's agent environment and run it with a session family. Probes runtimes, detects the stack, installs dependencies from the lockfile, searches marketplaces and GitHub for the best free plugins (language server, framework, browser driver) and installs them with their binaries, smoke-tests everything, scaffolds AGENTS.md, a board, sign-off and release records and a conflict-free memory, and enforces each role's limits with a pre-tool guard and a git pre-push check. Then stands up a Chief of Staff, the owner's only contact, with role sessions that report to it: Builder, QA, Design, Librarian and Researcher from the start; Security, Tech Lead, Release Ops, Hotfix, Platform and Support when a piece needs them. Detects the project's own branches, records the owner's yes for flow changes and kit upgrades, and caps helper agents per session. Use when starting work in a repo, when asked to bootstrap, set up the environment, memory or tooling, start the session family, or upgrade the kit in a project that already has it. Any stack, one agent or many, new or underway.
license: MIT
compatibility: Needs git and Node 18+ for the bundled tools. Full enforcement in Claude Code; adapters for Cursor, Codex, Copilot, Antigravity, Devin, Kiro, OpenCode, Cline, Aider and ChatGPT degrade as documented in references/adapters.md.
metadata:
  version: 0.6.0
  repository: https://github.com/AnfalHaider/Bootstrap-environment
---

# Agent environment bootstrap + session family

Two jobs, in order: **(1) environment** — detect the stack, install what it needs to build and test,
install the plugins that fit, prove each works, scaffold rules, records and memory; **(2) session
family** — one owner who talks only to the Chief of Staff, and role sessions with fixed jobs, kits,
lanes and limits that report to it. The tooling enforces the limits, not just describes them. Sessions
push without a permission click; the pre-push check is the gate.

Runs ONCE per project. **Detect; do not ask what you can determine.** Ask the owner only the project's
size (prototype / small / live: it picks the preset), the boundary questions (Phase 0H), the session names (Phase 7B), and anything paid, elevated, account-creating or
HIGH/CRITICAL.

**Already bootstrapped?** If `AGENTS.md`, `.bootstrap/policy.json` and `docs/memory/` exist and
`node .bootstrap/bin/mem.mjs check` passes, run Phases 0–1 only, report, and jump to the phase that is
genuinely incomplete. Say which phases you skip and why. If `.bootstrap/kit.json` is missing or older
than this kit's version, offer the upgrade (Phase 6) first.

**Install mode: AUTOMATIC** within the hard stops. Installs are reported, not pre-approved.

## Tools in this kit (Node 18+, no dependencies)

`bin/` paths below are relative to the **kit root**: the folder that holds `bin/bootstrap.mjs`. That is
this SKILL.md's own folder when the skill is installed on its own (`~/.claude/skills/bootstrap-environment/`),
two folders above it in the plugin (`${CLAUDE_PLUGIN_ROOT}`), or the cloned repo. Check which exists
before running anything. After `init`, the same tools live in the project at `.bootstrap/bin/`.

| Command | Does |
|---|---|
| `node bin/detect-stack.mjs [dir]` | stack profile: languages, lockfiles → exact install commands, frameworks, language servers, needs |
| `node bin/bootstrap.mjs init --size …` | scaffold into the project (never overwrites): `.bootstrap/`, `AGENTS.md`, board, register, memory, `.githooks/pre-push`; detects the live branch and a dev branch only if one exists |
| `node bin/bootstrap.mjs upgrade` | Chief of Staff, from the newer kit: refresh the kit's own files in a bootstrapped project (keeps policy, flow, edited roles, records) |
| `… bootstrap.mjs kit apply --words … --question …` | Chief of Staff only: record the owner's yes to the upgrade (sha256 of every kit file); a kit-only push that matches passes |
| `node .bootstrap/bin/bootstrap.mjs role <id>` | mark a worktree's session role; narrow its plugins; add its deny rules |
| `… bootstrap.mjs signoff <piece> --verdict PASS` | write `docs/signoffs/<piece>/<role>.md` with the sha |
| `… bootstrap.mjs require <piece> <roles…>` | set which roles must sign a piece (e.g. add `security`) |
| `… bootstrap.mjs release <scope> --shas … --words … --question … --said-at … --check <file>` | release record (7E) |
| `… bootstrap.mjs piece <piece> --lane <lane>` | Chief of Staff only: route a piece to a lane (code with no routed piece is refused) |
| `… bootstrap.mjs approve <piece> --word approve\|go --words … --question … --said-at … [--artifact <link>]` | Chief of Staff only: record the owner's approval of a design, or "go" for HIGH work |
| `… bootstrap.mjs flow [--open]` | flow editor (local only, one page): sessions On / Optional / Off, extra checks, kinds of work, helper limit, try a change; also `/flow` |
| `… bootstrap.mjs flow apply --words … --question …` | Chief of Staff only: record the owner's yes to the saved flow; a flow-only push that matches passes |
| `… bootstrap.mjs family` | sessions on from the start vs optional; branches; helper limit |
| `… bootstrap.mjs flow check` · `flow sources [role]` | check the flow (exit 1 on error) · each session's preferred sources |
| `… bootstrap.mjs company init <dir>` · `flow --company <dir>` | create / edit company defaults with locked floors |
| `… bootstrap.mjs brief <role>` | that role's rules (in full, with reasons) + its part in the flow: the session's first message |
| `… bootstrap.mjs next <piece>` · `board --mine` · `board archive` | what a piece still needs · only your rows · move old DONE rows out |
| `… bootstrap.mjs piece <piece> --suggest` · `cost` | suggest a lane from changed files · start cost per session and what is growing |
| `node .bootstrap/bin/mem.mjs index \| report \| find <topic> \| check` | memory CLI |
| `bin/guard.mjs` | pre-tool hook: blocks what a role must never do (exit 2 + reason); helper agents over the limit, on a bigger model, or forks |
| `bin/prepush.mjs` via `.githooks/pre-push` | refuses unsigned code, live pushes without a record, flow or kit changes without the owner's recorded yes, conflict markers — in every tool |

Test the kit itself with `npm test` (in the kit repo).

## Hard stops (automatic mode still stops here)

- Anything that costs money, needs a paid key, an account, or accepting terms.
- Anything needing elevation or a system-wide package change.
- Any change to a REAL database, service or folder named in 0H.
- A plugin from a non-official source whose hooks and MCP config you have not read, or that fails the trust check.
- More than two existing source/config files mutated at once.
- HIGH / CRITICAL work without the owner's go.

Stop = say what, why, and the exact action the owner can take. Carry on with everything else.

## Rules (each with the failure that produced it)

- **R1 Probe before install** — run `--version`; never trust a resolved path. *Windows `python` can be a Store stub that passes `command -v` and fails.*
- **R2 Smoke-test before enable** — execute every hook branch (allow, deny, malformed). *A guard that crashed on load silently allowed everything.*
- **R3 Rejecting is the job** — every tool's schema rides in every request; justify each install against THIS stack; each session gets only its kit.
- **R4 Free only** — *"if the free tier died tomorrow, would this stop working?"* Yes → reject.
- **R5 Working, BLOCKED or REJECTED** — never half-installed. Resolve plugin → runtime → binary → config → smoke test.
- **R6 Back up and pin** — back up before machine-scoped changes, state the rollback; pin remote sources to a commit SHA / exact version.
- **R7 One writer per file** — per-session logs, one file per lesson, one file per sign-off.
- **R8 Nothing is deleted** — supersede, preserve, record the migration.
- **R9 Do not touch work in flight** — no `reset --hard`, force-push or rebasing others' work.
- **R10 Report failed runs; never retry identically.**
- **R11 No mass mutations** — >2 existing files: show the diff, apply to one, inspect, ask.
- **R12 CLAIM → EVIDENCE, or UNKNOWN.**
- **R13 Risk first** — LOW / MEDIUM / HIGH (schema, auth, permissions, money, tenancy, security, deploy) / CRITICAL (production data, credentials, irreversible).
- **R14 Probe capability boundaries** — never assume what another agent or tool can or cannot do. *Two whole protocols were built on untested "X cannot" sentences.*

## Phases

**0 — PROBE (read-only).** Machine runtimes, stack profile (`detect-stack`), brownfield state, every
agent's history on disk, deploy blast radius, secrets (location only), then the boundary questions to
the owner. → `references/probe.md`

**1 — BASELINE.** Characters ÷ 3.6 of every always-loaded instruction file and tool schema. Phase 10
is judged against it.

**2 — DEPENDENCIES.** Lockfile-exact installs per workspace (install, never update); runtime versions
through user-level version managers only; lifecycle scripts off for untrusted code; write
`scripts/bootstrap` with exactly the commands that worked — the same script runs locally, in every
worktree and in the cloud hook. → `references/stack-and-plugins.md`

**3 — PLUGIN DISCOVERY.** For each need (language server, framework, browser/E2E, design, security,
docs lookup, services, workflow skills) search: installed → added marketplaces → the official
marketplace → GitHub (`gh search repos`, `gh search code "filename:plugin.json"`, the framework's
own org, a web search). **Run `bootstrap flow sources` first**: each session's preferred sources (company-required, company-approved, then the ones the owner pasted) are searched before anything else and win ties; blocked sources are never installed. Score: fits stack + version, licence, free (musts); official, maintained
(high); adoption, context cost (medium); no duplicates. Trust-check anything non-official (hooks that
call the network or run downloaded code, obfuscation, unpinned `npx`/`uvx` MCP servers → reject).
Pick ONE per need. → `references/stack-and-plugins.md`

**4 — INSTALL** the picks at project scope with their server binaries; GitHub sources pinned to a SHA;
settings backed up first. **5 — VERIFY**: a real LSP query, a real MCP call, a real browser action,
every hook branch. Only what passed is enabled.

**6 — SCAFFOLD.** Already bootstrapped (`.bootstrap/policy.json` exists)? Upgrade instead: `node bin/bootstrap.mjs upgrade` from this kit, tell the owner what changes (this kit's CHANGELOG.md), and on their yes `node .bootstrap/bin/bootstrap.mjs kit apply --words … --question …`; commit the kit files with the record on their own and push (the `/upgrade` command walks through it). Otherwise `node bin/bootstrap.mjs init --size <prototype|small|live>` (branches are detected: live = the remote default, dev only if one exists; override with `--live <b> --dev <b>|none`) (add `--project-hooks`
for Claude Code sessions without the plugin, e.g. cloud). Then: write the 0H answers into `AGENTS.md`
and `.bootstrap/policy.json` (`destructive_commands`), absorb existing conventions (move, don't
retype), and build the gate if none exists. → `references/scaffold-and-memory.md`,
`references/operating-rules.md`

**7 — SESSION FAMILY.** The owner talks only to the Chief of Staff; every other session reports to it. Ask which preset fits (Full company / Small team / Solo / Custom) and whether a company defaults repo exists. Offer the flow editor (`/flow`, or start `bootstrap flow` and open its link in the browser pane) so the owner can switch sessions On / Optional / Off, adjust extra checks and the helper limit; or take the changes in chat. Record the owner's yes with `bootstrap flow apply` and run `bootstrap flow check` until it passes. Start only the sessions On from the start (`bootstrap family`: by default Builder, QA, Design, Librarian, Researcher); optional ones (Security, Tech Lead, Release Ops, Hotfix, Platform, Support) start when a piece needs their sign-off or the owner asks. Show the owner one table — role id · job in this project · on or optional · proposed display
name · kit — and get names confirmed and project lanes chosen. Each writing session: its own worktree with REAL dependency folders, `bootstrap
role <id>`, its own database copy on the one shared server. Start them as linked sessions of the Chief of Staff (they report to it; the owner never has to switch chats or approve their pushes), each with its role file
plus `bootstrap brief <id>` unchanged (it says who the session reports to, that the owner's word arrives as a committed record, and its helper limit): only that role's rules, in full with reasons (~1k tokens instead of ~7k);
each restates them before working. Sessions then ask the tools (`next`, `board --mine`) instead of re-reading files.
Run `bootstrap cost` after starting the family and monthly; archive the board when it warns. Relays, sign-offs,
batches, freezes and messaging rules → `references/session-family.md`. Other tools → `references/adapters.md`.

**8 — SEED MEMORY.** Lessons from Phases 0–5 first, then mine every history store with an extractor
that prints counts only, chunked subagents with reserved id blocks, `mem check` on their output,
dedupe. Zero lessons is a valid answer. → `references/scaffold-and-memory.md`

**9 — PROVE IT.**
- `mem check`; `mem find <real topic>`; break a lesson's path on purpose, show `check` catching it, restore.
- `node --test` the kit's tests in the project (`.bootstrap/bin` is the same code).
- Try a forbidden push from a non-release role and show the guard and the pre-push hook refusing it.
- Change the flow without recording a yes and show the push refused; then `flow apply` and show it accepted.
- Ask the guard for a third helper agent, or one on a bigger model, and show it refused.
- The gate on a clean tree (report failures honestly; if work in flight prevents a clean tree, say so).
- Start the app, walk one real user path, read the console and failed requests.

**10 — REPORT.** `STATUS: PASS / PARTIAL / BLOCKED / FAILED` · stack profile · dependencies per
workspace · plugins INSTALLED (source, SHA, sessions) / BLOCKED (unblock action) / REJECTED (reason,
including every GitHub candidate) · session family (id → name → kit → started → restatement OK) ·
context cost baseline → now · backups and rollback commands · history stores mined or not · work in
flight left alone · secrets found (location/type only) · gate result · ONE recommended next action.

> **STOP. Do not start feature work. Wait for the owner.**

## This run FAILED if

- anything enabled that you did not execute, or installed but not working and not marked BLOCKED
- a lockfile's versions changed, or a GitHub plugin installed unpinned or unread
- anything paid, elevated, account-creating or system-wide done without the owner
- work in flight modified, or an existing convention overwritten instead of absorbed
- a secret value printed, copied or committed
- a capability boundary asserted without probing it
- the boundary questions or the session names not confirmed by the owner
- a session started without a role id, display name, brief, kit, worktree, or `bootstrap role`
- an optional session started without a piece that needs it or the owner asking
- a flow change or kit upgrade pushed without the owner's recorded yes, or a kit upgrade mixed with project code
- a session signing as another role, or anyone but the Chief of Staff routing pieces or recording the owner's words
- a session asking the owner directly instead of the Chief of Staff, or acting on a relayed message with no record behind it
- `bootstrap flow check` failing, or a project flow that tries to loosen a company floor
- the pre-push hook not installed (`git config core.hooksPath` ≠ `.githooks`), or a session approving its own work
- Hotfix started locally, or a cloud move that left the local copy running

Say so plainly even if the end state looks fine. A quiet failure here is the most expensive kind,
because everything downstream will trust it.
