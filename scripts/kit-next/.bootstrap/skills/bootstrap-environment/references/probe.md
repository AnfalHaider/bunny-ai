# Probe (Phase 0)

<!-- Reference file of the bootstrap-environment skill. Opened when SKILL.md points here. -->

## Phase 0 — PROBE (read-only; change nothing, not even formatting)

Report compact tables. Do not guess a row. Write UNKNOWN where honest.

**A. Machine.** OS, shell. Every plausible runtime BY RUNNING `--version`: node, npm/pnpm/yarn/bun,
python/uv/poetry, php/composer, go, rustc/cargo, java/mvn/gradle, dotnet, ruby/bundle, dart/flutter,
swift, elixir/mix, deno, docker, gh, git. Version managers present (nvm/fnm, uv, pyenv, rustup, asdf,
mise). Whether installs need elevation.

**B. Project → STACK PROFILE.** From manifests, lockfiles and source layout, NOT the README:

| Field | How |
|---|---|
| languages | file counts by extension, excluding dependency folders |
| package managers | from the LOCKFILE (table 2A), not from the manifest |
| required runtime versions | `.nvmrc`, `.node-version`, `.python-version`, `.tool-versions`, `mise.toml`, `composer.json` `require.php`, `go.mod` `go`, `rust-toolchain.toml`, `global.json`, `engines` |
| frameworks | dependency names (laravel/framework, next, django, rails, spring-boot, flutter…) and their markers (`artisan`, `manage.py`, `next.config.*`, `bin/rails`) |
| UI? | templates, components, CSS, a dev server script |
| database / services | env example files, docker-compose services, ORM config |
| test runner, linter, formatter, build, dev command | scripts in the manifest; config files |
| monorepo | workspaces, multiple manifests — profile EACH workspace |
| **gate** | the ONE command that gates a merge — find it, or state NO MERGE GATE FOUND |

Write the profile into the report; every later phase reads from it.

**C. Brownfield — is this already underway?** Uncommitted changes (count, whose, gated?); current
branch and divergence; other live branches; agent config (`CLAUDE.md`, `AGENTS.md`, `.claude/`,
`.cursor/`, `.github/copilot-instructions.md`, `.windsurfrules`, `.clinerules`); existing conventions
(`docs/`, ADRs, handover files, decision logs, CONTRIBUTING, a board, a `docs/memory/`); existing
hooks **and whether they actually run** (R2). Installed plugins (`claude plugin list` or
`~/.claude/plugins/installed_plugins.json`) and their scope.

⇒ Classify GREENFIELD / BROWNFIELD / MIGRATION. Active conventions are ABSORBED, never overwritten.

**D. Agents and their history.** *(R14 lives here.)* Which agents work here, from config and git
history (trailers, co-authors). Locate every agent's session history on disk, including agents that
are not you:

```
~/.claude/projects/<slug>/*.jsonl                    Claude Code
~/.cursor/projects/<slug>/agent-transcripts/         Cursor
~/.codeium/  ~/.windsurf/  ~/.continue/  VS Code globalStorage
```

Slugs differ per tool; match on a normalised form (lowercase, strip non-alphanumerics). Report per
agent: path, file count, bytes, parseable? **A zero-message result is a format mismatch, not an empty
store** — sample before believing. Sibling directories can look like transcripts and not be (Cursor's
`agent-tools/` is cached web fetches).

**E. Deploy blast radius.** How code reaches users; auto-deployed branches; staging; merge-to-live
time. Name the branch nobody pushes without permission. If unknown:
`DEPLOYMENT UNKNOWN — TREAT REMOTE BRANCHES AS DANGEROUS`.

**F. Constraints that will bite.** Limits of the agents actually present (e.g. Cursor silently drops
MCP tools past ~40). Find this one's; don't assume another's.

**G. Secrets.** Plaintext credentials in config you read: location, type, blast radius, rotation
advice. **Never print, copy, move or commit the value.**

**H. Boundary questions.** Ask the owner before any feature work; answers go into `AGENTS.md`:

| Ask | Why it must be written down |
|---|---|
| Which branch is live, which is dev/test, and what single word from whom moves live? | A release on a vague "yes" is a release nobody authorised. The word is typed in the releasing session, or relayed by the Chief of Staff verbatim with its question, shas, pasted check and sign-offs (7E). |
| Which databases, folders and services are REAL (customers, money, staff)? | A copy that looked like a copy was the live database once. Name the real ones. |
| What must never leave this machine (data, keys, screenshots of real data)? | Real-data screenshots in a repo are a leak with permanent history. |
| Is there an upstream or sibling project you must never write to? | A fork that can push to its origin will, one day. Disable the push URL. |
| Which routine-looking commands are destructive here? | A test suite that resets the DB, a cache clear that logs everyone out, a migration that rewrites money. |
| Who may run commands on the server, and must they be reported first? | Every live command is reported with exact text before, logged with server time after. |
| What is the one command that proves a change is safe (the gate)? | If none exists, build it in Phase 6. |
| Is there an invented-data copy for screenshots and tests? | If not, make one in Phase 6. |
| What are the project's cross-cutting areas that deserve their own lane? | Seeds the optional project lanes (Phase 7). |

## Phase 1 — BASELINE

Count what a session pays before any work: every always-loaded instruction file and existing agent
tooling, in characters, tokens at chars ÷ 3.6. Do not count browse-only artifacts an agent queries
rather than reads (a generated lesson index). Record the number; Phase 10 is judged against it.

