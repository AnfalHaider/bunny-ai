---
id: L007
date: 2026-11-17
session: builder
title: A fix is not done until the sha you send contains it; staging by folder list drops files
triggers: [commit, git, release, electron, security, verification]
files: [electron/main.js, src/server/app.js]
cost: half a day of review time and a release blocker
evidence: 'The desktop folder gate (D2-5) was edited in electron/main.js, node --check passed, and I reported it done, but every commit used git add -A src test e2e docs, which never included electron/. Security and Tech Lead read the file at the sha I sent and found createApp({ dataDir }) unchanged: the server-side gates (2f21cdd) were dead code in the shipped app. Found by their re-run, fixed in the next commit with a static wiring test.'
status: live
---

**What happened.** A security fix had two halves: the server gate, and the one line in the
desktop app that switches it on. The server half was committed and tested through the
server's own option; the desktop half was edited but never staged, because the commands
listed folders (`src test e2e docs`) instead of using `git status`. The report said "wired".

**The rule.** Before saying a fix is done: run `git status --short`, then read the changed
lines **at the sha you are about to send** (`git show <sha>:<file>`), and add a test that
fails if the switch is not on (a static check of the line is enough when the app cannot be
run). A server-side option that nothing turns on is not a fix.

**Also.** Never stage by a list of folders on a change that touches another one: stage
with `git add -A` after reading `git status`, or name every file.
