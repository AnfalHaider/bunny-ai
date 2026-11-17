# Builder B - session log

Newest entry on top. Only this session writes this file.

## 2026-11-17 - v0.1.9 second build lane (night 2): what was built and what is open

**Task:** the Chief of Staff's v0.1.9 queue for Builder B. Every row is its own branch from main 4995d5f (or from `claude/release-0.1.9` for the later ones); nothing was gated by me except RUN (see below); reviews and the one candidate gate were Builder A's and the Chief's.

**Built and pushed** (branch = sha at the time of writing; `git log` on the branch shows later fixes)
- `claude/builder-b-supd` S-UPD: a release with no sha512 is refused before any download; semver ordering (rc before plain); SUPD-1 (same-line 88-character base64 value) and SUPD-2 (basename).
- `claude/builder-b-soauth` S-OAUTH f929949: every sign-in request resolves its host, refuses a private address, connects to the checked address (`pinnedFetch`).
- `claude/builder-b-w612` W6-12: the task list carries over to the next message (quoted notes in a user-role message after the system text), cap 40, one nudge per reply.
- `claude/builder-b-w616` W6-16: skills, connectors and plugins limited to folders (read_skill and connector tools included; W616-1 plugin update keeps the scope; CSS rules live in the bindings file).
- `claude/builder-b-w624` W6-24: browser panel tabs as views (partition `persist:bunny-browser`, Security's ten rules, ::ffff: forms, throwaway profile for the smoke probe). NOT proven in a real Electron window.
- `claude/builder-b-w66` W6-6 (HIGH): `install_from_github` (Node.js MCP servers from public repos; card from one commit; `--ignore-scripts`; folder inside `<data>\tools`; card values from the repository are checked).
- `claude/builder-b-w610` W6-10: `browser_inspect` and `browser_capture` (saved page copy in the chat folder). Not run in a real page.
- `claude/builder-b-polish` POLISH (gaps 7 to 13): contrast, the model-switch line, the question guard, typed stops, the schedule prompt count, the two search-stop messages.
- `claude/builder-b-priv` PRIV: the Windows user name is out of scripts/kit-next and the app.js comment.
- `claude/builder-b-run` RUN (parked, OUT of v0.1.9 by the Chief): the unit-test runner in two steps (every `*.test.js` in parallel, the guard and kit files one at a time with CLAUDE_PROJECT_DIR unset), a 4-minute silence watchdog, a summary at the end. Its first gate failed only because an older version also ran helper and fixture scripts; a clean full run of the final version is still owed. The serial guard step took 21 minutes.

**Not built, with the reason**
- W6-11 (compare two pages): needs an off-screen view and pixel work that cannot be proven without a real window. Leave to a later release.
- W2-9 (a git worktree per code chat, ADR-002): the largest row: effectiveRoot everywhere, create and finish and cleanup of copies, a delete dialog, a Settings list of leftover copies, the data-folder gate exception and its ten tests. It cannot be finished and reviewed in one night; shipping part of it would leave a switch without its cleanup. Leave it out (the Chief said so in advance).
- W5-1d (guard work) was never mine. Gap 16 (release notes say "Pictures"/"Images") is in `docs/releases/`, which Builder may not touch: Librarian.

**Open items for whoever continues**
- A real Electron window walk for W6-24 and W6-10 (`npx electron test/probes/views-smoke.mjs <invented folder>`; the Electron binary is not installed in my worktree: a run starts a download, which I cancelled).
- W6-6 follow-ups: Python and other kinds of server, an "Allow install scripts" tick (needs a card with a checkbox), a check for a newer commit.
- "Clear browser data / sign out of all sites" button for the panel's partition (Security's note).
- The sandbox `BUNNY_ALLOW_LOOPBACK_DOWNLOAD=1` test switch is still there.

**Lessons**
- `git add -A` swept an unrelated untracked file (W6-6's) into another branch's commit: add files by name when a worktree holds more than one piece of work.
- Shell heredocs through the tool layer lose a backslash level: scripts with regexes or `\n` go in a file made with the Write tool (or the Edit tool), not into `node -e` or a heredoc. This cost about ten rounds tonight.
- Only one full gate or suite at a time, and ask first; a flag a script does not have yet still runs the script.
- A background run whose output goes into a pipe that the reader closes (`| head`) looks hung: write to a file.
- Automated security notes on model-written or repository-written text that reaches a card or the system prompt were right every time (task steps, package.json values): quote or check that text before it is shown.

## 2026-11-17 - v0.1.8 second build lane: final entry (retired by the Chief of Staff)

**Task:** second build lane for v0.1.8 under the Chief of Staff: the W6 line, then the queue the Chief set.

**What I built, and where it went**
- On the released line `claude/builder-b-w6-loop` (head bb5de9d, gate 8/8): the W6-x line, W4-8 (quick-ask key and busy message), W4-10 (plugin install and
  uninstall on the server, one at a time, double-click safe, uninstall signs remote connectors out), W3-6 meeting W4-10, the LA-2 fix, Security's fixes (W6-13,
  W6-9, W6-21, W69-1 read_url on file: addresses, W6-NEW-1 nothing written into .git, W613-2), Builder A's d790667 (W6-14, W3-6 final, W3-6b), W614-1 (a confirm
  card is never cut: code and action cards over 2,000 characters are refused, content cards are cut with a visible note), W3-3 and LA-4b (Auto still asks for
  a new tool, a schedule that may change things, a local connector), W6-7 (hints only; run_command always PowerShell), W6-8 (servers go to start_process),
  W33-1 (the schedule card shows its prompt), W4-14 (mode text from the tools really given, `leave_plan_mode` window-only card to Ask, `ask_user` guard,
  no-folder notice) and QA's fixes for W6-7, W6-8 and W33-1.
- On the side branch `claude/builder-b-v018-rc-parts` (375d368, NOT gated by me): the main 9c5ac84 merge, W4-9 (06b9d8c) with its blur fix, W6-20 (the 12 MB
  browser answer route), the W3-6b light-theme contrast, and the narrowed `asksToRunCommands`.

**Open items**
- Parked runner commits on `claude/builder-b-runner-wip` (head 0f0e5a4): 651ef6c (unit tests in two steps, the guard and kit files serially with
  CLAUDE_PROJECT_DIR unset), 3d046b5 (4-minute silence watchdog), 0f0e5a4 (the runner lists only `*.test.js`; the earlier version ran every helper and
  fixture, including servers that never exit, which is why its first unit run took 912 s and failed). Not run end to end yet; `node scripts/unit-tests.mjs --list`
  prints the split (78 parallel files, 18 guard and kit files). Needs one clean run and a gate before it goes anywhere; Tech Lead and Security review it (the gate is a control).
- Not started, moved to v0.1.9 by the owner: W6-12 (task list beyond the prompt), W6-16 (skills and connectors scoped to a folder), W6-24 (sites that refuse framing
  in the browser panel), W6-10/11 (capture and inspect a page, compare two pages), W2-9 (a worktree per code chat, ADR-002; stop and tell the Chief if it needs a
  `neverBrowse` exception), W6-6 (install a tool from any GitHub repo; HIGH, needs Security's sign-off). W5-1d was skipped on purpose (guard work, with K-2).
  W4-11 went to Builder A. PV-3 (fake provider scripting tool calls) was not needed: the scripted HTTP provider in the tests did the job.
- QA's gaps 10 to 13 in my areas: I was never given their text, so I cannot list them here. Read them in QA's sign-off notes (`docs/signoffs/*/qa.md`) and the
  Chief's gap list.
- Known small things: `BUNNY_ALLOW_LOOPBACK_DOWNLOAD=1` (test-only, turns off every address check; Security suggested renaming it) is still there. The edit
  card for `edit_file`, `multi_edit` and `download_file` is cut with a note when long, not refused (Security may want it refused). `run_command` in Auto shows no card,
  so a long command runs there (Security accepted that). The W4-9 blur e2e test was not proven to fail without the fix. Under a heavily loaded PC the gate's unit step
  can fail in the four guard and kit files (the guard's 6 s deadline); they pass serially with CLAUDE_PROJECT_DIR unset.

**Lessons**
- Never chain a push after a gate with `;` or on its own line: chain it with `&&` after a gate that exits non-zero on failure, or push by hand after reading the
  output. I once pushed a commit whose gate had failed (a94c3c3, a renamed test title the feature list named); I fixed forward, not by rewriting.
- Never pipe gate or suite output into `head` or `tail`: when the reader exits, the writer can block, and the run looks hung. Write to a file and read the file.
- Only one full gate or suite at a time on this PC, and ask the Chief first. A flag the script does not have yet still runs the script: test a new flag in a
  command that cannot start the real work.
- Edit with the Edit or Write tool, not through shell quoting: backslashes in regexes and `\n` in strings were eaten four times.
