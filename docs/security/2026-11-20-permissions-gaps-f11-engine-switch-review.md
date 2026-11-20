# PERMISSIONS-GAPS, the F13 revision, the F11 drawing and the ENGINE-SWITCH drawing: Security's required changes

Security, 2026-11-20. These are spec and drawing reviews only: no build and no tests.

- **Specs:** `docs/plans/PERMISSIONS-GAPS-spec.md` and the F13 revision in `AGENT-FLOW-F8-F13-HIGH-spec.md`, at 68d43ec0.
- **Drawings:** F11 (artifact JtLH5EMEhaTcDBet9GW1gr) and ENGINE-SWITCH (artifact 8PVUWffQhf2h7pdAH4GR4u).
- **Still in force:** F9-1 to F9-7, F11-1 to F11-7 and F13-1 to F13-5 (`2026-11-20-agent-flow-f8-f13-review.md`), plus ES-1 and ES-2.

## PERMISSIONS-GAPS

### PG-1: domain rules

- **PG1-a. Matching.**
  - The host is normalised first: lowercase, the trailing dot removed, IDN converted to punycode (`new URL`), and numeric forms of an IP literal normalised through `new URL`.
  - `*.x.com` matches subdomains only, and `x.com` matches exactly. The editor offers both.
  - Ports are ignored.
- **PG1-b. An allow never weakens a fixed protection.** That covers `fetchLimited`'s private-address refusal (WA-1), the Quick ask read_url allow-set (WA-2) and the taint rule.
- **PG1-c. The browser panel.**
  - Deny and ask are enforced in the panel's session with `webRequest.onBeforeRequest`, for every request: the main frame, sub-frames, XHR and fetch, and downloads. Top-level navigation alone isn't enough.
  - An ask on a sub-resource counts as a deny, because no card can stop a page mid-load. Settings says so.
- **PG1-d. Remote connectors.** A connector's address is judged when it is added and again whenever it changes. A deny on its host stops its calls.

### PG-2: tool rules

- **PG2-a.** Connector tool rules are stored by **connector id plus the original tool name**, and the person sees the connector's name. Renaming a connector, or a clash rename of a tool, can't escape a rule.
- **PG2-b. An allow never switches a capability on.** An allow on `computer_*` or `browser_*` doesn't offer those tools unless the capability is on.
- **PG2-c.** An allow never removes a fixed ask, as specified. The rule list marks those as "always asks".

### PG-3: agent rules

- **PG3-a.** `message_session` is a send, so an allow rule may **not** skip its card. The test "an allow skips the Ask-mode card" applies to `helper:*` and `chat:start` only.
- **PG3-b.** A helper's own calls stay under the chat's rules, including PG-1, PG-2 and PG-4. A helper can't start helpers or chats: `HELPER_NEVER`, unchanged.

### PG-4: protected writes

- **PG4-a. Add these** to the list, matched case-insensitively at any depth on the realpath relative to the workspace:
  - **The instructions files Bunny follows (required):** `AGENTS.md`, `CLAUDE.md`, `.cursorrules` and `.cursor/rules/**` (the files under `.claude/` and `.cursor/` are already listed). Without them, the model in a trusted folder can rewrite the instructions every later chat follows.
  - `.gitattributes` (filters and textconv run programs) and `.gitmodules`.
  - CI configuration: `.gitlab-ci.yml`, `azure-pipelines.yml`, `.circleci/`, `Jenkinsfile`, `.buildkite/`.
  - `lefthook.yml`, `.lefthook*`, `.envrc` and `.pnpmfile.cjs`.
  - `*.psm1`, `*.sh` and `*.vbs`.
- **PG4-b. The `package.json` exception is narrower.** "Dependencies only" means the change adds **no new package name**, and changes no version to a URL, git, `file:`, `link:`, `github:` or tarball form. Adding a dependency asks in Auto, because the next install runs its scripts.
- **PG4-c. With Bunny's engine off** (ENGINE-RULES, the floor only), the spec must say whether PG-4 joins the floor.
  - **Recommendation:** yes, as a **flag** on the engine's card where there is one, as the floor already does for commands. Not a deny, since the person chose "follow the engine".
  - This needs the owner's word, because it extends ER.

### PG-5: read-only commands with no card

- **PG5-a. Bunny runs the git forms with fixed options.**
  - `git -c core.fsmonitor= -c core.pager=cat -c diff.external= --no-pager <cmd>`, plus `--no-ext-diff --no-textconv` on `diff`, `log -p` and `show`.
  - Without them, a repository's config or attributes can make `git status` or `git diff` run a program. `core.fsmonitor` runs on `git status`.
- **PG5-b. Paths in the arguments are judged as reads.**
  - The path arguments of `dir`, `Get-ChildItem`, `type`, `Get-Content` and the like go through the read rules, the floor and the protected paths. A path outside the workspace gets a card.
  - Otherwise `type C:\Users\…\.ssh\id_ed25519` would run with no card.
- **PG5-c. Only the exact listed forms, with an allowlist of flags each** (for example `git log --oneline -n <N>`).
  - An unknown flag gets a card.
  - `npm ls` and `node --version` take no other arguments.
- **PG5-d.** The taint card and the person's rules still come first, as specified.

### PG-6: imports

Adopted. Also:

- the import screen shows each changed rule's new meaning **before** saving;
- an import that would add an allow wider than an existing deny is listed first.

## F13 revised (B where Codex is present, otherwise A, with C as an option, after spike S-F13B)

The order is adopted. The requirements:

- **F13B-1. The spike first.** Its output goes to Security as a file under `docs/research/` **before B is built**. It answers (a) to (f) and includes the raw `generate-json-schema` excerpt for `command/exec`.
- **F13B-2. Bunny sets every field of the call, every time.**
  - The sandbox policy is `workspace-write`, with the writable roots exactly `[workspace realpath]` plus `<root>/.bunny/tmp`.
  - Network is **off by default** for a confined command, unless the person turns it on in the setting. This applies if the spike's (e) shows it can be turned off.
  - The cwd is inside the workspace. The environment is `safeEnv` plus the cache variables.
  - Nothing in the call comes from the model.
- **F13B-3. The app-server used for commands** has a dedicated isolated home, with **no sign-in**. It never uses the person's Codex account home.
  - Its `config.toml` is rewritten by `ensureUntrusted`: the CE-1.14 features off, and `project_doc_max_bytes = 0`.
  - It talks over stdio only; nothing listens on a port.
  - Any approval or escalation request it sends gets **deny** from Bunny, never accept.
- **F13B-4. Tests:**
  - `command/exec` with a write outside the root fails;
  - a request to widen the roots is denied.
- **F13B-5. The help text says plainly** that confined commands can still **read** everything the person can, Bunny's data folder included, under both A and B. Files encrypted with this user's DPAPI key can be decrypted by any process that runs as the person, so confinement limits writes, not reading secrets.

## F11 drawing

Answers to Design's questions:

- **(a)** Yes. The fixed first line comes first, and the judge's reason is quoted after it, cut to 200 characters, with control characters removed.
- **(b)** Yes, the fall-back lines are fixed.
- **(c)** Yes. Keep that sentence in the help.
- **(d)** Yes, a chip.
- **(e)** Yes, "Auto without the check".

Required changes:

1. **Remove "your trusted project instructions"** from what the check sees, in both the In-short list and the Settings note (F11-1).
   - The check sees only your own typed messages and the action itself.
   - It never sees web pages, file text, the folder's instruction files or Bunny's earlier replies.
2. **Model that checks Auto actions.** When a model of another provider is picked, the row says "Each checked action is sent to <provider>" (F11-4).
3. **"Not used in Auto with the check on"** shows the full F11-6 list, not three examples.
4. **"Skips the check: reads, and edits inside your project folder"** adds "except files that change how code runs later, which always ask" (PG-4).
5. **An action too long for the check** shows "Asked: too long for Bunny's check to see whole" (F11-2).
6. **A scheduled run in Auto** doesn't fall back to cards. Its line reads "Stopped: Bunny's check could not run, and nobody is here to ask" (F11-5).

## ENGINE-SWITCH drawing

Answers to Design's questions:

- **(a)** Yes, restricted follows the engine (ES-2).
- **(b)** Yes, window only.
- **(c)** Yes, it matches F9.
- **(d)** Yes: fenced, cleaned and never saved.
- **(e)** Yes. The "Not followed yet" variant is required.

Required changes:

1. **The card body adds the ES-1 exclusion.** After "a summary of the conversation", add "(answers that used files from this PC are left out)". Show it only when the chat has such answers.
2. **The engine's-own-rules variant names that engine's own behaviour.**
   - Codex: "asks you about every command and file change", which is true today.
   - Claude Code: "follows the rules you set for it in Settings › Engines: Allow runs with no question, Ask shows a card, Deny stops it".
   - The card never says "asks about every…" for an engine whose Allow rules run without a card.
3. **The restricted variant** also says what happens when switching away, for example "Codex CLI runs in full mode; Claude Code stays restricted if you come back".
4. **"Claude Code (other)"** in the menu: if it means a second account or mode, its line says which. Switching between them goes through the same card and the same handover.
