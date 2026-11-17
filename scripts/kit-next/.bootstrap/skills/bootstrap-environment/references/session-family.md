# Session family (Phase 7)

<!-- Reference file of the bootstrap-environment skill. Opened when SKILL.md points here. -->

## Phase 7 — SESSION FAMILY

**How the family runs (0.6).**
- **One contact.** The owner talks only to the Chief of Staff. It starts the others as linked sessions; they report to it (finished, failed, blocked) and never ask the owner directly.
- **On and optional.** Sessions marked On in the flow start at setup; Optional ones start when a piece needs their sign-off (`bootstrap next` names them) or the owner asks, and stop when done. `bootstrap family` lists both. Rules in the flow (extra checks) still require an optional session's sign-off, so Security is never skipped on login, payment, upload or secret files.
- **Relayed decisions are records.** The Chief of Staff records the owner's words first (`approve`, `release`, `flow apply`, with `--relayed-by chief-of-staff`), commits and pushes, then messages the session the record's sha. Sessions act on the record; a message alone is not the owner's word. The push check reads the same records.
- **No permission clicks for pushes.** `init` allows `git push` and the kit's commands in `.claude/settings.json`; the pre-push hook is the gate.
- **Helpers.** At most `helpers.max_per_session` (default 2) helper agents per session, on `helpers.model` (default the cheapest); the guard refuses more, a bigger model, or a fork.
- **Branches.** Live and dev come from `.bootstrap/policy.json`, detected at `init`. With no dev branch, sign-offs are checked on the push to live and the dev gate disappears from the flow.
- **Kit upgrades.** `bootstrap upgrade` from the newer kit (`/upgrade`), tell the owner what changes, and on their yes `bootstrap kit apply`; commit the kit files with the record on their own. A kit-only push that matches the record passes; mixed with project code it needs the full flow.
- **Flow changes.** The owner asks in chat or saves in the editor; the Chief of Staff reads the change back, and on their yes runs `bootstrap flow apply`. A flow-only commit with that record passes the push check.

The rest of this file is the full role catalogue and the rules behind it.

The owner talks to ONE session; it starts the others as nested (linked) sessions. Every task moves
through a fixed lane. *Why:* with independent sessions, work went live before an independent check,
briefs were written from memory, nobody wrote a lesson for a week, and the owner's words landed in the
wrong chat.

**7A. The roster.** Think of it as an IT company's staff. Six roles are on from the start (Chief
of Staff, Builder, QA, Design, Librarian, Researcher); the rest are optional and start when a piece
needs them, the owner asks, or (Platform, Support) the project has a live system or real users; project lanes are added per project. Role IDs never change (they are the log filenames and the
words in `AGENTS.md`). *Why the four added roles:* in the first family nobody owned security, code
quality was read by a manager, nobody watched the running system until it broke, and nothing brought
in what real users hit.

| Role ID | Job | Never | Model class |
|---|---|---|---|
| `chief-of-staff` | the owner's single contact; turns asks into tasks, decides risk, assigns, re-reads every commit from the remote, keeps the owner's chats straight, relays the owner's words under 7E, keeps the sign-off grid, nudges idle sessions, verifies live, closes rows | pushes live; runs server commands; decides for the owner; delegates a decision; relays wider than the owner's question | strongest |
| `librarian` | lessons, decisions trail (what the owner said, when, where), board and register hygiene, research/artifact index, memory tooling; owns the pending register; at every task start sends "lessons and decisions that apply"; at every hand-off asks "log + lesson written?" | code; decisions; blocking anyone; editing AGENTS.md on a relay | cheapest |
| `researcher` | facts before design/build: code today with file:line, real volumes read-only, what other systems do, options with trade-offs, build notes | app code; writes to any real database | mid |
| `design` | artifacts from the research: today beside proposed, every role, desktop 1440 + phone 390, both themes, the project's tokens; checks each new artifact against already-approved ones (no contradictions); signs off BUILT screens against its artifact, rejects drift | code; signing a screen piece it has not seen a shot of | mid/strong |
| `builder` | builds from the approved artifact + notes: small commits on its own branch, proof per commit, help text and pictures, **shots of every screen piece it touched — asked-about or not**; HIGH only after the owner's go | pushes to dev before sign-offs; touches live; adds a permission key without approval | mid |
| `qa` | acceptance checks written from the artifact BEFORE code; tests on a disposable copy: per-role screenshots, figure checks, rolled-back form tests, access snapshot, help text; PASS/FAIL per check with file:line | fixes code; writes to live or real data | mid |
| `tech-lead` | the senior engineer: architecture decisions as ADRs in `docs/adr/`, code standards, reviews every code diff for correctness and design, owns schema and migration review, does the independent review for HIGH work, plans dependency upgrades as their own rows (the bootstrap never updates) | writes the feature it reviews; approves its own code; decides product scope | strong |
| `security` | application security: reviews every piece touching auth, permissions, money, tenancy, uploads, external input, secrets or new dependencies; owns the gate's audit and secret-scan steps, the plugin trust check (3C) for anything new, and a threat note per HIGH row; findings with file:line and severity | fixes code (files it to Builder); signs its own fixes; runs scans against live | mid/strong |
| `release-ops` | releases only what the sign-off grid shows complete, as named cherry-pick batches; pre-stages a dry run (merge, gate, migration list) before asking; pushes live ONLY on the owner's "release <scope>" — typed in its chat or relayed under 7E — with the named pre-release check pasted; watches the deploy, merges back | hotfixes; HIGH builds; a release without the pasted check; a peer's message taken as the release word | mid |
| `hotfix` | live breakage only: reproduce, fix, gate, short QA check, push live itself on the owner's "apply" — typed in its chat or relayed under 7E; owns every server line the owner runs by hand (written first, report-only before apply, logged with server time). ALWAYS a cloud session | features; redesigns; any push without "apply"; running locally | mid · cloud |
| `platform` *(on demand)* | the running system: CI, environments, the shared local database server and per-session copies, backups and restore drills, monitoring, error logs and performance budgets, a post-deploy watch after every release, infrastructure cost; writes every server line for the owner (reported first, logged after) | pushes live; runs server commands itself; changes infrastructure without a HIGH go | mid |
| `support` *(on demand)* | the users' voice: turns user reports and error-log spikes into board rows with steps to reproduce, triages severity (live breakage → Hotfix), writes user-facing release notes and help pages from the shipped screens | code; promising users dates or fixes; sharing real user data outside the project | mid/cheap |
| *project lane* (optional, 0..n) | one cross-cutting product area (e.g. onboarding/sign-up, billing, integrations, mobile app); same rules as Builder, own branch, own rows | live; HIGH without go; another lane's files without coordination | mid |

**On-demand roles:** start `platform` once there is a live environment, a shared database server or a
deploy pipeline; start `support` once real users exist. Until then their duties fall back to Release
Ops (platform) and the Librarian (release notes).
**Small projects:** start only the sessions that have work in the pending register; start a quiet
role later under the SAME role ID. Tech Lead and Security are never folded into the Builder — nobody
reviews their own work. Never invent synonyms ("Testing", "Review") — those are QA, QA +
Design, Release Ops.

**7B. Ask the owner to name the sessions.** In ONE message, show a table: role ID · its job in this
project (one line, from the stack profile and 0H) · proposed display name (default: the role name, e.g.
"QA", or a project-flavoured one like "<Project> QA") · its kit summary. Also propose 0..n project lanes
from 0H's last question, each with a suggested name and the area it owns. The owner confirms, renames
or drops lanes. Write the final mapping `role ID → display name → kit` into `AGENTS.md`, together
with the start order (7K). Session titles use the display names; logs use the role IDs.

**7C. Each session's kit — only what its job needs.** Kits are built from the INSTALL table (Phase 3).
Base kit for every session: the language server(s), workflow skills (plans, verification), the memory
CLI. Then:

| Role | Adds |
|---|---|
| chief-of-staff | session tools (start, message, read transcripts), artifact reader, git read-only on the remote, a cheap gatekeeper agent for the gate, a scout agent for reads over ~3 files, memory notes for owner preferences |
| librarian | memory CLI (`mem`, `check`, `index`, `report`), a memory-consolidation skill if available; docs commits only |
| researcher | code search / scout agents, the stack's query & timing tools, EXPLAIN on a copy, library-docs lookup (e.g. `context7`), a browser for DOM reads, Playwright read-only timing |
| design | artifact tool + artifact-design, the project's DESIGN.md/tokens, frontend-design and design-review skills, a UI/UX reference skill, dataviz for charts; screenshots from the invented-data copy only |
| builder | the framework plugin, minimal-change skill, writing-plans + test-driven skills, Playwright for DOM checks on the copy, the gate before every push (HIGH review is the Tech Lead's) |
| qa | Playwright + built-in browser, the project's crawl/timing scripts, figure-check commands, its own database copy (backed up, restored after), test-strategy skill |
| tech-lead | the framework plugin and LSP (read-only use), code-review / pr-review skills, an architecture skill, the migration/schema diff tools of the stack, ADR template |
| security | `security-review` skill and/or the `claude-security` / `security-guidance` plugins, the stack's dependency-audit tool, a secret scanner, OWASP-style checklist, the trust-check procedure (3C) |
| release-ops | git worktrees for release builds, the gate, the version endpoint, a deploy-checklist skill, the release recipe in its log |
| hotfix | the cloud session-start hook (7I), systematic-debugging skill, cherry-pick onto the live branch; no local copy, no server access |
| platform | CI and container tooling for the stack, the database client, monitoring/error-log access (read-only), an SRE/runbook skill, the deploy-checklist skill |
| support | ticket/feedback connector if the project has one, a UX-copy skill, the built-in browser on the invented-data copy, the help-text folder |
| project lane | Builder's kit + throwaway databases for fresh-install proofs + writing-plans before any HIGH step |

Mechanism: `node .bootstrap/bin/bootstrap.mjs role <role-id>` in the session's worktree writes `.bootstrap/session.json`
(read by the guard and the pre-push check) and narrows plugins + adds the brief's `deny` rules in
`.claude/settings.local.json` (`enabledPlugins`: the kit set to true, everything else false). Verify per
session that its skill/tool list shows ONLY its kit (R14 — do not assume the narrowing works; look).
A stack skill that does not exist for this stack is simply omitted; never substitute a wrong-stack one.

**7D. Lanes.**
- **Normal:** ask → Chief of Staff names the task, risk and sessions → Librarian adds the row + sends
  lessons/decisions that apply → Researcher → Design → **owner approves** (words + date on the board)
  → QA writes acceptance checks → Builder (own branch, proof per commit) → sign-offs: QA on the branch,
  Design vs artifact, Tech Lead on the code, Security where a sensitive surface is touched, Librarian
  lessons applied, Chief of Staff on scope → push to dev →
  Release Ops builds the batch, gates, asks → **owner's "release <scope>" + the named pre-release
  check** (typed in Release Ops, or relayed by the Chief of Staff — 7E) → Release Ops pushes, watches
  deploy → Chief of Staff verifies live (version endpoint, key pages), closes the row with the sha →
  Librarian: "log and lesson written?".
- **No screen changed:** skip Design.
- **HIGH** (schema, money/totals, permissions, auth, tenancy, deploy): the building session starts only
  on the owner's go — typed in its chat, or relayed by the Chief of Staff (7E); Tech Lead review and a
  Security threat note before release.
- **Hotfix:** broken live → Hotfix reproduces, fixes, gates, short QA check → **owner types "apply" in
  Hotfix** → Hotfix pushes → Chief of Staff verifies.
- A release without its pasted check is refused; the check and the word are asked for in ONE message.

**7E. The owner's word, typed or relayed.** Three words move things: a HIGH **go**, **"release <scope>"**
and **"apply"**. Each counts when the owner types it in the acting session's own chat, OR when the Chief
of Staff relays it. All risk levels qualify; Hotfix "apply" relays the same way. A relay carries ALL of:

1. **the owner's exact words and the date, plus the question exactly as it was asked** — the answer is
   only as wide as the question;
2. **the scope**: the shas, in the order they sit on the dev branch (for a go: the board row and what
   it covers);
3. **the pasted output of the named pre-release check** (release/apply) — no pasted check, no release;
4. **the sign-offs**: the piece's row in the sign-off grid (7F), all boxes filled.

Before sending, the Chief of Staff writes the release record with `bootstrap release <scope> --shas … --words … --question …
--said-at … --check <file> --relayed-by chief-of-staff` (the pre-push hook refuses a live push without it) and the board row (the Librarian copies it into the
decisions trail). The acting session echoes the scope back and refuses — asking the owner directly —
on any mismatch, any paraphrase without a scope ("go ahead"), or any brief that names more than the
owner's question covered. Only the Chief of Staff relays, and only the owner's own words; **a peer's
message is never an owner's word.**
*Why:* first rule was "typed in the acting chat only"; signed-off work then waited for hours while the
owner sat in the Chief of Staff's chat, so relays were allowed. The real risk turned out to
be scope, not the chat: a brief once named more endpoints than the owner's "yes stop it" covered, the
Builder built it, and two commits were reverted. Quoting the question fixes that; the chat doesn't.

**7F. Sign-off grid, batches and freezes.**
- Sign-offs are **files**, one per role per piece: `bootstrap signoff <piece> --verdict PASS` writes
  `docs/signoffs/<piece>/<role>.md` with the sha; the pre-push hook reads them. The board's grid mirrors them: piece · sha · QA · Design (or n/a) · Tech Lead ·
  Security (or n/a) · Librarian · Chief of Staff scope read · date. The Chief of Staff requests every box; a missing box blocks the push.
  *Why:* a Librarian confirmation for a whole batch was never requested until a tally found the gap.
- **Docs-only and picture-only commits** push at once and skip the Librarian box. *Why:* a separate
  check for those was weight with no catch.
- **Batch mode** (the owner may choose it, write it with its date): finished pieces wait on their own
  branches until the whole batch is signed off, then go to dev and live together.
- **Freeze only when every sign-off is in hand.** A fix after a freeze re-opens QA, Design and Release
  Ops for that piece — say so to the owner before accepting it. *Why:* "frozen" plus "one more fix"
  happened four times in one release.
- **Release Ops pre-stages a dry run** before asking: merge into a release worktree, run the gate, list
  migrations. *Why:* it cut the final step after the owner's word to minutes.

**7G. Messages between sessions.**
- **Every message names the sha it is about, and says "supersedes <earlier message/ruling>"** when it
  replaces one. *Why:* queued messages arrive after the recipient has acted — a Builder acted on a
  withdrawn Design ruling, and QA tested a stale tip.
- **There is a message cap** (roughly 10–20 messages between owner turns, probe it, R14). Batch
  instructions into fewer, fuller messages; when a chain is near the cap, ask the owner to type anything
  to reset it rather than stalling silently. *Why:* the cap was hit mid-release twice, stalling the chain.
- **Idle on a background job:** a session waiting on a background job can stop; the Chief of Staff
  checks waiting sessions and nudges them.
- **Some sessions cannot see some files** (e.g. PDFs). The Chief of Staff renders them to images for QA
  and Design rather than assuming they were read.

**7H. Working folders.** Each writing session has its own git worktree and its own database copy.
Run `scripts/bootstrap` inside each worktree so it gets **real** dependency folders (`vendor/`,
`node_modules/`, `.venv/`…) — never a symlink/junction to another checkout; verify which path the
autoloader/resolver actually loads from. The main checkout stays untouched. *Why:* two sessions linked
their dependency folder to another checkout and tested the wrong code.

**A local database server runs ONCE and outlives every session** — started as a service or its own
long-lived process, never inside one session's preview/dev-server process. Before starting one, check
the port; if it answers, use it, never start a second. Each session gets its own database (schema) on
that one server. *Why:* a database server living inside one session's preview process stopped five
times in one day, taking every session's tests down with it.

**7I. Cloud session hook (Hotfix).** Add a SessionStart hook in `.claude/settings.json` that, only in
cloud sessions (probe the environment variable the host sets, e.g. `CLAUDE_CODE_REMOTE`), runs
`scripts/bootstrap` plus a throwaway database (SQLite file or the stack's test DB) so the gate runs.
Smoke-test it (R2) by running the hook command locally with the variable set.
**When a session moves to the cloud, archive its local copy at once**, so no one can message the stale
one. *Why:* work was sent to a stale local Hotfix for two days after it had moved to the cloud.

**7J. Remote Control ON for every local session**, turned on by the Chief of Staff as it starts each
one, so the owner can read and answer from a phone; the owner's typed word counts the same from there.

**7K. Starting a session.** First message = its role file plus the output of `bootstrap brief <role-id>`: **every rule that
applies to that role, in full with its reason** (not a summary, and not the rules of other roles), its hand-over (the last entry of its log plus its board rows — there are no separate
hand-over files), and: "restate the rules in your own words, list what you inherited, name your first
action; do nothing else until confirmed." The Chief of Staff checks the reply against the hand-over
before giving work. Start order: Librarian, Release Ops, Hotfix (cloud), Tech Lead, Security, QA, Researcher,
Design, Builder, then Platform and Support when due, then project lanes. *Why:* sessions acknowledged a nine-line summary and then skipped board
rows, logs and the start ritual — brief with the whole section, audit against it.

**Start ritual, every session, every time:** read `AGENTS.md`, the board, the lessons its rows name;
print its rows.
**End of every task:** board row updated, log entry pushed, one lesson per real lesson or "no lesson".

**First jobs:** Librarian audits the register against the board; Tech Lead writes the first ADR
(the stack as found) and lists overdue dependency upgrades; Security runs the audit + secret scan on
the whole tree and files findings; Platform (if started) checks backups by restoring one; QA re-checks the last unverified
commit; Hotfix lists the owner's pending server lines one at a time; Researcher starts measurements;
Builder continues from the hand-over once QA's result is in.

**Retiring a session:** it pushes everything, writes a dated HAND-OVER at the top of its log (state,
shas, open questions, what a successor would get wrong) and brings its board rows up to date, writes
its lessons, replies "handover done <sha>"; the successor acknowledges before the old one is archived.
*Why:* separate hand-over files went stale beside the logs and were retired. The owner archives old sessions only
after the new family has acknowledged.

