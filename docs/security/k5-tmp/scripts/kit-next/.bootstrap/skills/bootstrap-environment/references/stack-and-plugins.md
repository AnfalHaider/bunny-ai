# Stack, dependencies and plugins (Phases 2-5)

<!-- Reference file of the bootstrap-environment skill. Opened when SKILL.md points here. -->

## Phase 2 — DEPENDENCIES BY STACK (automatic)

Back up nothing here (project-local, reversible by deleting the folder), but never touch a lockfile's
versions: **install, never update**. Run per workspace in a monorepo.

**2A. Lockfile → install command.**

| Lockfile / marker | Command | Folder it creates |
|---|---|---|
| `composer.lock` | `composer install --no-interaction --prefer-dist` | `vendor/` |
| `package-lock.json` | `npm ci` | `node_modules/` |
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` | `node_modules/` |
| `yarn.lock` | v1: `yarn install --frozen-lockfile` · berry: `yarn install --immutable` | `node_modules/` |
| `bun.lock` / `bun.lockb` | `bun install --frozen-lockfile` | `node_modules/` |
| `uv.lock` | `uv sync --frozen` | `.venv/` |
| `poetry.lock` | `poetry install --sync` | venv |
| `Pipfile.lock` | `pipenv sync --dev` | venv |
| `requirements*.txt` only | `python -m venv .venv` then `.venv` pip `install -r` each file | `.venv/` |
| `go.sum` | `go mod download` | module cache |
| `Cargo.lock` | `cargo fetch --locked` | cargo cache |
| `Gemfile.lock` | `bundle config set --local frozen true` then `bundle install` | bundle path |
| `packages.lock.json` / `*.csproj` / `*.sln` | `dotnet restore --locked-mode` (no lock: `dotnet restore`) | `obj/` |
| `pom.xml` | `mvn -B -q dependency:go-offline` | `~/.m2` |
| `gradle.lockfile` / `build.gradle(.kts)` | `./gradlew --no-daemon dependencies` | gradle cache |
| `pubspec.lock` | `flutter pub get --enforce-lockfile` / `dart pub get --enforce-lockfile` | `.dart_tool/` |
| `mix.lock` | `mix deps.get` | `deps/` |
| `Package.resolved` | `swift package resolve` | `.build/` |
| `deno.lock` | `deno install --frozen` | cache |
| a manifest with NO lockfile | install, then COMMIT nothing; report "NO LOCKFILE — versions unpinned" | |

Rules for this phase:

- **Runtime version first.** If the profile names a version and the machine's differs, install it
  through a user-level version manager already present (nvm/fnm, `uv python install`, rustup, mise,
  asdf). No user-level manager → BLOCKED with the exact install line. Never system-level.
- **Untrusted repo?** If the code came from outside the owner (a fork, a download), first install with
  lifecycle scripts off (`npm ci --ignore-scripts`, `composer install --no-scripts`), read the scripts,
  then run them.
- **Post-install steps the framework expects** (copy `.env.example` → `.env` ONLY if `.env` is
  absent, generate an app key, build assets) are run against the invented-data copy, never a REAL
  database from 0H.
- **Proof:** the dependency folder exists, the resolver answers (`composer validate`, `npm ls --depth=0`,
  `uv pip check`, `go build ./...`, `cargo check`), and the gate's fastest piece runs.
- **Write `scripts/bootstrap`** (`.sh` + `.ps1` on Windows projects) containing exactly the commands
  that worked here. The SAME script runs on the owner's machine, in every worktree (Phase 7H) and in
  the cloud session-start hook (Phase 7I). *Why:* when local and cloud setup are described separately,
  they drift, and the Hotfix session tests code that never built.

## Phase 3 — PLUGIN DISCOVERY (search everywhere, pick the best)

**3A. What the stack needs** (from the profile). Each row is a NEED, not a pick:

| Need | When |
|---|---|
| language server for each primary language | always |
| framework skill/plugin | a framework was detected |
| browser / E2E driver | the project has a UI or E2E tests |
| design skills | the project has a UI |
| static analysis / security review | always — one, not three |
| library docs lookup | dependencies are numerous or fast-moving |
| database / service tooling | a service from 0B the sessions will query (read-only) |
| workflow skills (plans, TDD, debugging, verification, code review) | always — once, shared by all sessions |

Known-good starting points in the official marketplace (`claude-plugins-official`) — verify each
still exists before relying on it (R14):

| Language | Plugin | Server binary (user-level install) |
|---|---|---|
| PHP | `php-lsp` | `npm install -g intelephense` |
| TypeScript / JavaScript | `typescript-lsp` | `npm install -g typescript-language-server typescript` |
| Python | `pyright-lsp` | `npm install -g pyright` |
| Go | `gopls-lsp` | `go install golang.org/x/tools/gopls@<pinned version>` |
| Rust | `rust-analyzer-lsp` | `rustup component add rust-analyzer` |
| Ruby | `ruby-lsp` | `gem install ruby-lsp` |
| C# | `csharp-lsp` | `dotnet tool install --global csharp-ls` |
| Java | `jdtls-lsp` | jdtls (package manager / release archive) |
| Kotlin | `kotlin-lsp` | kotlin-lsp release |
| C / C++ | `clangd-lsp` | clangd (LLVM) |
| Swift | `swift-lsp` | sourcekit-lsp (ships with the Swift toolchain) |

General-purpose official picks to consider: `superpowers` (plans, TDD, debugging, verification),
`playwright`, `frontend-design`, `code-review` / `pr-review-toolkit`, `security-guidance`, `context7`,
`commit-commands`, `claude-md-management`, `hookify`. Framework examples: `laravel-boost` (official)
or the `laravel` marketplace for Laravel; `expo`, `vercel`, `supabase`, `firebase`, `stripe`, `sentry`
only when that service is actually in the stack.

**3B. Search every source, for every need.**

1. Plugins already installed on this machine (reuse beats install).
2. Marketplaces already added (`claude plugin marketplace list`; their `marketplace.json`).
3. The official marketplace.
4. **GitHub**: `gh search repos "<need> claude code plugin" --sort stars --limit 20`,
   `gh search code "filename:plugin.json path:.claude-plugin <keyword>"`, and a web search for
   "<framework> Claude Code plugin" / "<framework> agent skill". Also check the framework's own
   GitHub org — official framework plugins usually live there.

**3C. Score and pick ONE per need.**

| Criterion | Weight | Evidence |
|---|---|---|
| fits THIS stack and version | must | framework/version named in its docs or code |
| official (Anthropic, or the framework's own org) | high | repo owner |
| maintained | high | last commit < 6 months, issues answered |
| adoption | medium | stars, forks, installs |
| license allows use | must | LICENSE file (MIT/Apache/BSD/etc.) |
| free (R4) | must | no paid key, no billing |
| context cost | medium | number of skills/tools/MCP schemas it loads |
| no duplicate of an existing pick | must | overlap check against installed + chosen |

**Trust check for anything not from an official source** — read before install, reject on any hit:
hooks that call the network, download and execute code, read files outside the project, or are
minified/obfuscated; MCP servers fetched at run time by an unpinned `npx`/`uvx` name; install scripts
needing elevation. Record what you read (file names) in the report.

**3D. Output** (shown in the report, NOT a stop gate — install mode is automatic):

| Table | Columns |
|---|---|
| **INSTALL** | need · source (marketplace or `owner/repo`) · pinned ref · why THIS repo · binary · context cost · which sessions get it |
| **BLOCKED** | blocker · exact unblock action |
| **REJECT** | candidate · reason (paid, redundant, wrong stack, unmaintained, failed trust check, cost > value) |

If projected context cost exceeds ~30% of baseline, CUT before installing.

## Phase 4 — INSTALL (automatic; only the INSTALL table)

- Back up `.claude/settings.json` / `settings.local.json` and state the rollback BEFORE the first write.
- Official or known marketplace: `claude plugin install <plugin>@<marketplace> --scope project`.
- GitHub source: `claude plugin marketplace add <owner>/<repo>` (pin: add at the vetted commit, or
  record the SHA from the marketplace clone and refuse to update past it without a re-check), then
  `claude plugin install <plugin>@<marketplace> --scope project`.
- Probe the CLI first (`claude plugin --help`, `claude plugin install --help`) — flags change (R14).
- Resolve every dependency to working (R5): a language-server plugin is only a config shim — install
  the server binary too; an MCP server needs its runtime and a first real call; a hook needs its
  interpreter on PATH (absolute path where the platform is fussy).
- Project-scoped installs go into `.claude/settings.json` so every worktree and the cloud session get
  them; per-session kits are narrowed in Phase 7C.

## Phase 5 — VERIFY

For EVERY installed item **and every pre-existing hook this bootstrap relies on**:

| Kind | Test |
|---|---|
| dependencies | resolver check + the gate's fastest piece |
| hook | realistic payload, assert output, every branch |
| MCP | one real call returning meaningful data |
| LSP | binary answers AND a real query (go-to-definition / hover) resolves in THIS codebase |
| skill | appears in the agent's skill list |
| script | success path AND failure path |
| browser | launches and performs one real action against the running app |

Enable only what passed. Failures become `BLOCKED | reason | unblock action` (R12).

