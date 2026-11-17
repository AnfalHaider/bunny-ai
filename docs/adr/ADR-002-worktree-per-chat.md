---
title: ADR-002 A git worktree per code chat (W2-9): where the copy lives and what it needs
author: tech-lead
date: 2026-11-16
status: accepted by Tech Lead, with the changes below. Needs Builder's tests; MEDIUM, Security signs the data-folder exception.
asked_by: chief-of-staff (design: docs/design/review-016/index.html section 2 at 5b0392a; plan b2eefcc)
---

# Decision

**Confirm: the copy lives in Bunny's data folder, never inside or beside the project, with these changes.**

Path: `<data folder>\worktrees\<repo-slug>-<hash6>\<chat-id first 8>`. Never the chat's title or the branch name in the path (titles can hold reserved names, trailing dots and very long text). `repo-slug` is the folder name cut to 24 characters, `hash6` is from the repo's real path, so two repos called `app` do not collide. Branch: Settings Branch prefix + short slug + chat-id first 8 (`bunny/tidy-greeter-3fa91c2e`), created with `-b` from the repo's current HEAD; if the name exists, add a counter. Finish: Keep the branch (default), Merge, Discard, as drawn.

Model: keep `session.folder` as the folder the person picked (chips, trust card for project files, gate). Add `session.worktree = { path, branch, base, baseSha }`, written only by the server. **The effective root** for workspace tools, `run_command` cwd, checkpoints, Changes, Files and Session panes is `worktree.path` when present, else `folder`. One function, `effectiveRoot(session)`, used everywhere; no caller reads `session.folder` for file access any more.

# The four questions

## 1. A different drive from the repo: works, with three rules
`git worktree add` accepts any path; the copy's `.git` file and the repo's `.git/worktrees/<name>` point at each other by absolute path, so the drives do not matter.
- (a) If the repo moves or is renamed the link breaks: run `git worktree repair` once before use, and if the repo path is gone show "The project folder moved; pick it again" and keep the copy.
- (b) A repo on a network share or removable drive: the copy exists but git commands fail when the drive is away. Treat any git failure as "project folder not reachable", never as an empty diff.
- (c) Refuse the switch (greyed, with the reason in the card) for: a non-git folder, a repo with submodules (`.gitmodules`; worktrees and submodules do not mix well), a bare repo, and a repo with no commits.

**What the copy does not contain:** only tracked files. No `node_modules`, `.env`, build output or other untracked files, so `npm test` in the copy fails until dependencies are installed. The card says it in one line ("Files git does not track, such as node_modules, are not copied"), and a command failure in a copy that has a `package.json` but no `node_modules` should say so. Uncommitted changes in the person's own folder are not in the copy either; show "from main at abc1234".

## 2. Path length on Windows
Prefix budget: the data folder (about 60 characters for `C:\Users\<name>\AppData\Local\BunnyAI`) plus `\worktrees\` plus slug (24) plus hash (7) plus id (9) is about 115 characters, leaving about 140 for the repo's deepest tracked path. Pass `-c core.longpaths=true` on every `git worktree add` and checkout in the copy. Whether Electron and Node here handle paths over 260 characters is **UNKNOWN**: nothing in `electron/` or the build config sets long-path awareness. Test, do not assume (test 3 below). On failure to create or check out: remove the half-made copy and its branch, and say "The path is too long for Windows; shorten the data folder or the project's folder names."

## 3. Cleanup when a chat is deleted
Never lose work silently, never remove anything outside `<data folder>\worktrees`.
- Stop the chat's background processes first (Windows will not delete a folder a process runs in), then retry removal 3 times, 500 ms apart, on `EBUSY` and `EPERM`.
- **Clean and nothing unique** (no uncommitted changes, branch has no commits the base lacks): `git worktree remove`, then `git branch -d` (safe delete, never `-D`).
- **Dirty or has commits:** the delete dialog says what there is ("3 files changed, 2 commits on bunny/tidy-...") and offers: *Keep the branch* (default: commit what is uncommitted as one "Bunny: work in progress" commit on the branch, remove the copy, keep the branch), *Discard* (asks twice, then `worktree remove --force` and `branch -D`), *Cancel*.
- Finish uses the same code path.
- Removal re-checks that the resolved path is inside the real `<data folder>\worktrees` and equals a `session.worktree.path` in a saved chat (use the `inside()` gate); anything else is refused.
- Start-up sweep: copies under `worktrees\` that belong to no saved chat are **listed in Settings ("Leftover copies", with size and Remove), never deleted automatically**; entries whose folder is gone get `git worktree prune`.
- Incognito chats never get a copy. Chat import and export carry the branch name only, never the path. A chat whose copy is missing shows "This chat's copy is gone; the branch `bunny/...` still has the work" and falls back to the picked folder only after the person says so.
- Merge: `--ff-only` into the base branch only if the person's own folder is clean and on that branch; otherwise Merge is greyed with the reason and Keep is the answer. No non-fast-forward merge in the person's folder in 0.1.6 (a conflict would leave their working tree half-merged).

## 4. Panes and the folder gate (the part that can go wrong)
- **`chosenFolders` is for folders the person picked.** The copy is made by the server from a folder that was picked, so the server registers it at creation and again when a chat with `session.worktree` is loaded, in a set separate from picks if that is simpler. `POST /api/folder/check` and the PATCH routes must never be able to add it, and `session.worktree` must not be in the `sessions.update` patch whitelist, the `setting/` route, or import: it is written only by the create and finish functions. A script cannot point a chat at an arbitrary folder through it.
- **`neverBrowse(folder, dataDir)` refuses anything inside the data folder, and the copy is inside it.** Add one exact exception: a root is allowed when its real path is inside the real `<data folder>\worktrees\` **and** equals the `worktree.path` of the session asking. The data folder itself, `secrets`, `sessions`, `connections.json` and every other subfolder stay refused. Test with a junction from the worktrees folder to the secrets folder (refused) and with `worktrees\..\secrets` (refused).
- Pane routes (`/api/sessions/:id/changes|files|file`) and `changesFor` take the effective root; `inside()` is rooted at it. `.git` in the copy is a file; it stays hidden and unreadable by the existing rule.
- Checkpoints already live under the data folder and store absolute paths; with the copy as root the paths are inside it, so Changes works unchanged, and "Undo to here" writes only inside the copy.
- Project instruction files (T-4) are read from the copy, but the trust card and fingerprint are keyed on the picked folder, so one approval covers all its chats.
- Scheduled runs and helper agents use the picked folder unless the schedule says otherwise: a schedule never gets a chat's copy.
- The model cannot turn the switch on or off: it is a UI route behind the token, not a tool.
- Two chats on one repo: serialise `git worktree add/remove/prune` per repo (they take locks in the shared `.git`) with one queue per repo path.

# Tests Builder must show (named in the row)
1. Two chats on one invented repo edit the same file in their own copies; both Changes diffs are correct; the repo's own folder is untouched (the plan's test).
2. Copy on another drive than the repo (skipped when only one drive exists, with a unit test on the path code using injected paths).
3. A tracked file 200 characters deep checks out in the copy; if it cannot, the half-made copy and branch are removed and the message is shown.
4. Delete a clean chat: copy and branch gone. Delete a dirty chat: dialog; Keep leaves the branch with one WIP commit and no copy; Discard asks twice and removes both; Cancel changes nothing. A process running in the copy does not block removal.
5. A copy folder with no saved chat is listed, never deleted by itself. A path outside `worktrees` is refused by removal.
6. Gate: `POST /api/folder/check` for the copy path does not choose it; setting `worktree` through chat PATCH, the setting route and import is ignored or refused; `neverBrowse` allows the session's own copy and refuses the data folder, `secrets`, a junction into it, and another chat's copy.
7. Repo with `.gitmodules`, non-git folder, bare repo, no commits: the switch is disabled with its reason.
8. Repo folder renamed after the copy was made: `worktree repair` or the "project folder moved" message, never an empty Changes pane.
9. Merge: fast-forward works when the person's folder is clean; greyed when it is dirty or on another branch.
10. Old chats (no `worktree` field) behave exactly as before.

# Why this and not the alternatives
Beside the project (`../repo-bunny-<chat>`) litters the person's folders and breaks tools that watch the parent. Inside the project needs a `.gitignore` entry, and the copy shows up in the project's own searches and builds. The data folder keeps everything Bunny made in one place that tests can invent (`BUNNY_DATA_DIR`), at the price of the exception above and disk use: show the total size of `worktrees` in Settings, and keep the folder out of any profile backup or export.
