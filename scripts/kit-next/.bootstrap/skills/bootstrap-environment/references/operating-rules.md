# Operating rules (seed AGENTS.md with these)

<!-- Reference file of the bootstrap-environment skill. Opened when SKILL.md points here. -->

**6B. Operating rules** — seed `AGENTS.md` with these, in the project's words, keeping the reasons:

**O1 · Evidence, or UNKNOWN.** "Done", "fixed", "working" only with command and output beside them;
every acceptance is re-checked by the Chief of Staff from the diff, not the report. *Why:* helper
sessions report confidently; several "fixed" claims were not.

**O2 · One gate command.** Nothing is pushed without it; its output is pasted into the report. *Why:* a
list of checks in prose is skipped by phase four; a single command is not. Where the app has pages and
roles, the gate **loads every page as every role** (at least a status-200 check) and **fails on any
route without an access guard** or an explicit public allow-list entry. *Why:* a template error gave
staff a 500 on every phone page and passed the gate, because the gate never loaded pages per role; and
new routes shipped unguarded until a check made it impossible. The gate also runs the stack's
**dependency audit** (`composer audit`, `npm audit --omit=dev`, `pip-audit`, `cargo audit`,
`govulncheck`, `bundle audit`, `dotnet list package --vulnerable`) and a **secret scan of the diff**;
a high/critical advisory or a found secret fails it.

**O3 · Design before build, for anything a person looks at.** Today's screen beside the proposal, same
positions and labels, both themes, phone and desktop widths, notes with file:line and risk — approved,
then built as drawn. *Why:* every build from a sentence was rebuilt; every build from a drawing went in
once.

**O4 · Roles with one key.** One session decides; builders build from a written spec; one session holds
the key to live and acts only on the owner's release word — typed in its chat, or relayed by the Chief
of Staff with the owner's exact words, the question asked, the shas, the pasted check and the sign-offs
(7E). *Why:* a vague relayed approval once nearly released unreviewed work; the fix that held was a
verbatim, scoped, checked relay — not forbidding relays, which stalled signed-off work for hours.

**O5 · Tour the data before touching a rule.** Read-only tour of the real data first: counts, duplicates,
odd values, which ids mean what. Keep a dated read-only copy for figure checks and an invented-data copy
for everything else. *Why:* the costly surprises were all data.

**O6 · Live commands are reported first and logged after.** Exact text, read-only ones included, waits
for the owner's go; logged with server time after. No credentials on the command line.

**O7 · Documentation that cannot go stale.** A screen change ships its help text and help pictures (from
the invented-data copy); the gate fails when a picture no longer matches its screen.

**O8 · A scripted walk after every batch.** Every page, every role, two widths, both themes: links,
buttons, errors, missing pictures, sideways scroll, timings. Cheap agents read the output; the Chief of
Staff triages. *Why:* a dead Cancel button lived for weeks because nobody walked the pages.

**O9 · Rules can carry dates.** "Not before X" rules carry the date and reason; the Chief of Staff parks
anything that would break them.

**O10 · Sign-offs before push.** No code reaches the shared dev branch until the relevant sign-offs are
in: QA on a copy, Design where a screen changed, the Tech Lead on code and schema, Security where the
piece touches a sensitive surface (7A), the Librarian for lessons applied, the Chief of Staff on scope
against the owner's words — tracked in the sign-off grid (7F). Hotfix lane excepted. **Docs-only and picture-only
commits (board, logs, lessons, research, help pictures) push at once and never need a go** — or the
board cannot work. *Why:* small commits reached dev before QA looked; and holding docs writes "until I
say" hid sessions' work from the repo.

**O11 · A push never follows a failed script.** Check for conflict markers before any push. *Why:* a
failed merge script once pushed a board file full of `<<<<<<<`.

**O12 · Questions live on the board.** Every owner question not tied to a row goes to QUESTIONS with a
recommendation; owner replies are short, plain, one question at a time. *Why:* questions left in chat
were lost.

**O13 · Every scratch script names its database in the same command.** No script relies on a default
connection or an environment file to pick the database; the target copy is named on the line that runs
it. *Why:* scratch writes landed in the real app database (a business record) and QA had to verify the
clean-up.

**O14 · Moving access from a role type to a permission tick is HIGH.** Compare every LIVE role's access
old against new, row by row, and never choose a tick that also grants other powers. *Why:* a tick that
looked equivalent quietly widened what some roles could do.

