---
id: L006
date: 2026-11-16
session: chief-of-staff
title: Count conflict markers after resolving, before committing the merge
triggers: [merge, conflict, release, board, crlf, union]
files: [docs/plans/BOARD.md, scripts/gate.mjs]
cost: 15m and two bad merge commits on a release branch
evidence: 'Assembling release/0.1.5, a script that kept both sides of BOARD.md conflicts matched nothing because the file had CRLF endings; its own check printed "markers left: 3", and the merge was committed anyway, twice (417297d, 7c8b0bf). Fixed by hand in 9a63051; git grep for markers then printed nothing. The gate conflict check would have refused a push.'
status: live
---

**What happened.** While assembling a release from several session branches, BOARD.md conflicted twice. A
small script was meant to keep both sides of each conflict, but it searched for `\n` line breaks in a file
saved with `\r\n`, so it changed nothing. The script even printed how many markers were left, and the merge
was committed regardless.

**Rule.** After resolving any conflict, run `git grep -nE '^(<<<<<<<|>>>>>>>)( |$)|^=======$'` and commit
only when it prints nothing. Normalise `\r\n` before matching text in this repo (core.autocrlf is true on the
owner's machine). A check whose output you ignore is not a check.

**Why it matters.** Conflict markers in a board or a source file reach every session and, on main, every
user. The gate catches them before a push, but a release branch is shared earlier than that.
