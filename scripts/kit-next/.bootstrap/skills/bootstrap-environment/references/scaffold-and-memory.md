# Scaffold and memory (Phases 6 and 8)

<!-- Reference file of the bootstrap-environment skill. Opened when SKILL.md points here. -->

## Phase 6 — SCAFFOLD (idempotent; absorb, never overwrite)

**Migration mode:** read every existing convention IN FULL. Keep entry-point filenames people already
use. Fold duplicated rules into ONE source with pointers. **Move content, don't retype it.** Show the
diff of what moved BEFORE removing it from its old home.

**`AGENTS.md`** at the repo root — the shared working agreement. Claude reads it via `@AGENTS.md` as the
first line of `CLAUDE.md`. Shared rules HERE; tool-specific material in that tool's own file. Never
duplicate. Contents: branches and the live word, the gate, risk levels, boundary answers (0H), operating
rules (6B), the roster with session names and kits (Phase 7), the start ritual and end-of-task list.
Single-agent projects still get it — it makes adding sessions a no-op.

**One layout, every project:**

```
AGENTS.md                         standing rules (Chief of Staff edits, only on the owner's typed word)
CLAUDE.md                         first line: @AGENTS.md
scripts/bootstrap(.sh|.ps1)       Phase 2 commands that worked
scripts/gate(.sh|.ps1)            the ONE gate command
.bootstrap/bin/                   toolkit: guard, pre-push check, mem, detect-stack, bootstrap (copied by `bootstrap init`)
.bootstrap/policy.json            branches, destructive commands, protected paths (Chief of Staff only)
.bootstrap/roles/<id>.md          role briefs — the first message to each session, unchanged
.githooks/pre-push                sign-off + release-record + conflict-marker check (core.hooksPath)
docs/signoffs/<piece>/<role>.md   ONE FILE PER ROLE PER PIECE (`bootstrap signoff`); `_required.md` sets the roles
docs/releases/<date>-<scope>.md   release records: owner's words, question, shas, pasted check (`bootstrap release`)
docs/plans/BOARD.md               the one list (format below)
docs/plans/pending-register.md    what waits on the owner / a session / was promised
docs/research/<topic>.md          research notes with file:line
docs/adr/ADR-###-slug.md          architecture decisions (Tech Lead)
docs/security/                    threat notes per HIGH row, audit results (Security)
docs/memory/MEMORY.md             index + open threads
docs/memory/logs/<session>.md     ONE PER SESSION, only that session writes; newest on top
docs/memory/lessons/L###-slug.md  ONE IMMUTABLE FILE PER LESSON
docs/memory/INDEX.md              GENERATED
docs/memory/LAST_REPORT.md        GENERATED — newest entry from each log
```

Generated files are never hand-edited; on conflict, RE-RUN the generator. Whoever commits last runs it.

**BOARD.md format.** Ownership map (which session owns which area) · QUESTIONS (numbered, dated, each
with a recommendation; the answer written in place with the owner's exact words and date) · OPEN rows
(id, title, risk, owning session, claimed-by + date, state, artifact/research links) · SIGN-OFF GRID
(piece · sha · QA · Design · Tech Lead · Security · Librarian · Chief of Staff · date — 7F) · RELAYS (each relayed owner word
with its question, scope and date — 7E) · DONE rows (sha, date verified live). A row is claimed before any code; state and sha are updated the moment work ships.
Every session edits only its own rows, as plain docs commits.

**pending-register.md.** Three lists: waiting on the owner · waiting on a session · promised and not
delivered. Nothing leaves it except as DONE with a sha or a dated owner decision.

**Lesson frontmatter:**

```yaml
id, date, session, title
triggers: [...]   # WHEN this becomes relevant — the retrieval key
files:  [...]     # UNQUOTED, repo-relative; what you'd open TODAY. Historical names go in the body.
cost:             # one line: what it actually cost
evidence:         # file, command, error string
status: live      # or: superseded_by: <id>
```

**Memory CLI** — shipped as `.bootstrap/bin/mem.mjs` (Node, no dependencies); run `node .bootstrap/bin/mem.mjs <cmd>`.
If the project cannot run Node, port it to a runtime Phase 0 confirmed — the four commands are the contract:

| Command | Does |
|---|---|
| `index` | regenerate INDEX.md from lesson frontmatter |
| `report` | regenerate LAST_REPORT.md from the session logs |
| `find <topic>` | print ONLY lessons whose triggers match |
| `check` | context budget + lessons naming missing files + malformed frontmatter + conflict markers in docs |

`check` matters most: **stale memory is worse than none, because it is trusted.**


## Phase 8 — SEED MEMORY

First, lessons from Phases 0–5: every rejected tool, failed smoke test, missing runtime, constraint,
deployment hazard. Then mine **every** agent history store from 0D, plus git log, ADRs, incident notes,
dense TODO/FIXME clusters.

1. **Never read raw transcripts into context.** Write an extractor that prints counts only.
2. **Extract message text only** — often ~3% of the file; the rest is tool output.
3. **Filter for real failure/decision/reversal language.** A plain instruction is NOT a lesson.
4. **Chunk to ~50 KB, one subagent per chunk**, each with a **reserved ID block**.
5. **Watch concurrency** — eight parallel agents hit a rate limit and died; four worked.
6. **Zero lessons is a valid answer**; two strong beat eight weak; no nameable cost → not a lesson.
7. **Run `check` on subagent output** — they produce plausible lessons with wrong paths.
8. **Deduplicate** before committing; afterwards, superseding is the only route (R8).

