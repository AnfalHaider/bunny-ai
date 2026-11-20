# REWIND: go back more than one reply

Tech Lead, 2026-11-20. Plan item D in `docs/plans/2026-11-20-v0.1.15-plan.md`.

- Design draws it first (O3). This spec is the behaviour Design draws against.
- Risk: MEDIUM. Rewind writes files in the person's folder.
- Security passed it with required changes RW-1 to RW-3 (33fac2db, `docs/security/2026-11-20-v0115-specs-review.md`). They are folded in below (§3.2 to §3.4, §6).

## 1. What exists today (read from the code)

### What a checkpoint is

- `src/server/checkpoints.js` makes one checkpoint per reply, and only once that reply changes a file.
- `capture(abs)` copies a file as it was **before** its first change in that reply. The copy is base64 inside `<dataDir>/checkpoints/<chatId>/<id>.json`. A file that didn't exist yet is noted as `existed: false`.
- A file over 5 MB is noted as `skipped` and not copied.

### What gets captured

These all go through `beforeWrite`:

- `write_file`, `edit_file`, `multi_edit` and `download_file` (`workspace.js`);
- the saved page copy (`writeFiles`, W6-10);
- step-note files (`app.js` ~2110);
- an engine's own Write, Edit, MultiEdit and NotebookEdit in full mode, before the write (`engines/service.js:308` and `:311`);
- every file a restricted-mode turn copies back, because it goes through the workspace write path (`engines/staging.js`).

### What is **not** captured

- Anything a command changed: `run_command`, `start_process`, an engine's Bash or shell.
- Anything changed outside Bunny.

### Undo today

- `POST /api/sessions/:id/checkpoints/:cid/restore` puts **one** reply's files back and marks the checkpoint `restored`.
- The message keeps `{ checkpoint: { id, files, restored } }` (`sessions.js:251`).
- The Changes pane lists the newest 20 checkpoints (`panes.js:15`).

### Gaps this spec closes

1. **G1. Restore overwrites without looking.** A file the person changed after the reply is silently overwritten.
2. **G2. Restore doesn't re-check the stored path.** It writes `f.path`, an absolute path saved earlier, without checking that it is still inside the chat's folder and not behind a link that appeared since.
3. **G3. Checkpoints are never removed.** Deleting a chat leaves its copies of the person's files in the data folder, and there is no size cap.
4. **G4. Only one reply can be undone at a time,** and you can't say "go back to here".

## 2. What is kept per reply (changed)

- **New: `after`.** When a reply ends, whether it is done, stopped or failed, the checkpoint records `after` for each captured file:
  - `{ hash: sha256 of the bytes | 'absent', size }`;
  - for a `skipped` big file, the hash is still recorded, by streaming it.
  - The turn already ends in one place for Bunny models and in one for engines. Both call `checkpoint.finish()`.
- **New: `messageId`.** This is the reply's message id, so a checkpoint can be found from a message without scanning.
- **New: `commands: true`.** Set when the reply ran any command: Bunny's `run_command` or `start_process`, or an engine command step. The preview uses it to warn.
- **Old checkpoints** (no `after`) still work. Each of their files counts as "can't tell whether it changed since" (§3.3).

## 3. Rewind

### 3.1 What the person picks

- **"Rewind to here"** on any earlier message, user or reply. That means: put every file back as it was just before the first reply that came **after** that point.
- The Changes pane lists each checkpoint with its own "Rewind to before this".
- Design draws both places, and the list (newest first, reply time, files and the line counts the pane already shows).

### 3.2 Preview first, always

- **`GET /api/sessions/:id/rewind?to=<messageId>`** writes nothing. It returns:
  ```
  { replies: n, files: [{ path, action, why? }], commandsRan: boolean, tooOld: boolean }
  ```
- `action` is one of:
  - `restore`: put the old content back;
  - `delete`: the file didn't exist then;
  - `changed`: changed outside this chat's replies since (§3.3);
  - `big`: over 5 MB, so it was never copied and can't be put back;
  - `refused`: the path is no longer allowed (§3.4);
  - `same`: it is already as it was.
- **How the end state is worked out.** The checkpoints after the point are walked newest first. For each path, the state to restore is the **before** copy in the **oldest** of them that touched that path.
- **Commands.** If `commandsRan` is true, the preview says: "Commands ran in these replies. Bunny can't put back what a command changed."
- **Who may preview (RW-1).** The preview is open to any device that can open the chat. It shows paths and actions only, which that device already sees in the chat's tool steps, and never file contents.
- **`to` (RW-3)** must be the id of a message in this chat. Anything else gets 404 `message.notFound`.

### 3.3 Files changed outside Bunny

- A path is `changed` when its current hash differs from the `after` hash of the newest checkpoint (after the point) that touched it.
- **RW-3: how the current hash is taken.** `lstat` the path first, without following links.
  - A regular file is read and hashed.
  - Nothing there means `absent`.
  - A link, junction or directory is `refused`, never hashed through.
- That catches all of these, which Bunny can't tell apart and shouldn't try to:
  - the person's own edit;
  - another chat;
  - a command;
  - git.
- **`changed` files are left alone by default.**
  - The person can tick each one ("Put back anyway").
  - The confirm card names them.
  - An old checkpoint with no `after` counts every file as `changed`.
- **The same rule now applies to the existing one-reply Undo (closes G1).** Undo of a reply whose file changed since asks first, through the same preview.

### 3.4 Writing

- **`POST /api/sessions/:id/rewind`** takes:
  ```
  { to: messageId, include: [paths ticked from changed], conversation: "keep" | "new-chat" }
  ```
- **The chat must not be busy.** If a reply is running, the answer is 409 `chat.busy`.
- **`include` (RW-3)** accepts only paths that the preview, worked out again now on the server, lists as `changed`. Any other path in `include` is ignored, and logged with the count only, so a request can't add paths of its own.
- **Every path is checked again now (closes G2):**
  - through the chat's **current** workspace: `insideEdit(rel, { mustExist: false })` against the folder's real path;
  - it must not be under `.git`;
  - no link anywhere on the way;
  - the person's edit **deny** rules apply, and give `refused` with the rule named.
  - Ask and allow rules don't add a card: the rewind card is the question.
  - A checkpoint whose `root` isn't the chat's current folder refuses all its paths.
  - That covers a worktree chat after Finish, and a chat whose folder was changed.
- **Rewind can itself be undone.**
  - Before anything is written, one new checkpoint, `kind: 'rewind'`, captures the current state of every path about to change.
  - The result card has "Undo the rewind".
- **RW-2: each path is checked again immediately before its own write,** not once for the whole rewind. The check is `insideEdit` plus the deny rules, as above. A link or junction that appears mid-rewind is then `refused` at write time.
- **Restore (RW-2).**
  - The target's parent folder is realpath-checked first.
  - The bytes are written to `<file>.bunny-rewind-<rand>` in that folder with `flag: 'wx'`, so an existing file is never clobbered, and then renamed over the target.
  - Renaming over a link replaces the link, not what it points to, and a crash never leaves half a file.
- **A missing parent folder (RW-2).** A file whose folder is gone is restored only after its parents are made inside the checked folder, one level at a time. Each new level is checked (`lstat`, not a link, inside the folder) before the next is made.
- **Delete (RW-2).** `lstat` first, and remove only a regular file, with `rm` and no `recursive`. A directory, link or junction is `refused`.
- **If a write fails**, Bunny stops and reports which paths were done and which weren't. The rewind checkpoint still covers the done ones.
- **Marking.** Every checkpoint after the point whose files were all handled (restored, same, or the person chose to leave it) is marked `restored`, and its message shows "Rewound".
- **RW-1: remote devices follow today's one-reply restore rule exactly,** so restore and rewind never differ. This is the Chief of Staff's recommendation, and Security accepts either level if the spec states it.
  - **A Chats device** gets 403. `POST /api/sessions/:id/rewind` and "Undo the rewind" are never added to `remotePolicy`'s `WRITE` list or to `remoteException`, just as `.../checkpoints/:cid/restore` isn't today.
  - **An Everything device** may rewind, as it may use today's restore. That matches the owner's OPEN-SIGNIN words: "Internet devices should be allowed to use the application as normal".
  - **Why not window-only:** that would make rewind stricter than the Undo it extends. Tightening one would then have to tighten both, which is a separate decision.
  - **If either is ever changed,** both change together, and a test holds them equal (§6, test 13).
  - **Logged.** Every rewind from a device, and every Undo of a rewind, goes in the R-DF2 action log (`remote.logAction`) as kind `rewind` with the path count only, never the paths or their contents.

### 3.5 The conversation

- **`keep`, the default.** The messages stay.
  - A fixed system note goes with the next message, for Bunny models and engines alike: "The person rewound the files to before reply N; the later replies' file changes are gone, and commands' effects may remain."
  - It is fixed text, with no file contents.
- **`new-chat`.** It also calls the existing `sessions.fork(id, { at })` at the point. The person goes on in a new chat that has only the earlier messages, and the original chat is left whole.
  - Bunny never deletes messages for a rewind.
- **Edit-and-resend** (`truncateFrom`, `app.js:1930`) now offers "Also put the files back". That is this rewind, with `to` set to the message being edited, and the same preview.

## 4. How far back

- **As far as the chat's checkpoints go**, with these limits (closes G3):
  - at most **100 checkpoints per chat**;
  - at most **1 GB of checkpoints across the profile**.
  - The oldest are removed first, when a new checkpoint is written.
  - A point older than the oldest kept checkpoint gives `tooOld: true`, with "This is older than Bunny keeps. You can go back to <oldest time>."
- **Deleting a chat** deletes `<dataDir>/checkpoints/<chatId>/` and the rewind checkpoints with it.
- **Incognito** has no tools and no checkpoints, so there is nothing to rewind.

## 5. Engines and restricted mode

- **Full mode** (Claude Code or Codex works in the real folder).
  - The engine's file-tool writes are captured, as today.
  - Its commands are not, so `commands: true` is set when the turn had a command step, and the preview warns.
  - The engine keeps its own session memory, so the §3.5 note tells it the files changed under it.
- **Restricted mode.**
  - Only what Bunny copied back into the real folder is in the checkpoint, so rewind puts back exactly that.
  - The staged copy is not part of rewind; it is rebuilt each turn.
  - A turn whose copy-back was discarded (nothing kept) has no checkpoint, so it has nothing to rewind.
- **Plan mode** writes nothing, so it has no checkpoints. The person may still rewind from the UI in any mode, because rewind is the person's action, not the model's.

## 6. Tests

### Unit (`test/rewind.test.js`, invented temp folders)

1. **Three replies** that write `a` (1→2→3), create `b`, then edit `a` and `b`. Rewinding to before reply 1 gives `a` = 1, removes `b`, and a second rewind of the same point says it was already done.
2. **Rewinding to before reply 2** leaves reply 1's state.
3. **The person edits `a` after reply 3.** The preview says `changed`. A rewind without `include` leaves it, and with `include: ['a']` puts it back.
4. **Old checkpoint.** A checkpoint without `after` makes every file `changed`.
5. **Over 5 MB.** A file over 5 MB is `big` and is left alone.
6. **G2:**
   - a stored path now behind a junction or symlink is `refused`, and nothing is written through the link;
   - so is a path under `.git`;
   - so is a checkpoint whose `root` is another folder;
   - an edit deny rule gives `refused` with the rule named.
7. **Undo the rewind** brings back the exact bytes from before the rewind.
8. **A failed write.** With a read-only target, the result lists done and not done, and the done files are covered by the rewind checkpoint.
9. **Busy chat.** A rewind while a reply runs gets 409.
10. **Limits.** The 101st checkpoint removes the oldest, and the 1 GB cap is tested with a small cap injected. Deleting a chat removes its checkpoint folder.
11. **The one-reply Undo** of a changed file now asks, and doesn't overwrite.
12. **`commands`.** A reply with a `run_command` step sets `commands`, and the preview says so.
13. **RW-1, devices:**
    - a Chats device's `POST .../rewind`, `POST .../rewind` undo and `POST .../checkpoints/:cid/restore` all get 403;
    - an Everything device's rewind and restore both succeed and each writes one `rewind` (or restore) action-log entry with a count and no paths;
    - one test asserts that rewind and restore are treated the same in `remotePolicy`;
    - the GET preview works from a Chats device that can open the chat, and holds no file contents.
14. **RW-2, write time:**
    - a link swapped in for a target after the preview is `refused` at write time, and nothing is written through it;
    - a `delete` aimed at a directory or a junction is `refused`, and the directory is still there;
    - an existing `<file>.bunny-rewind-<rand>`-style file is never clobbered (`wx`);
    - a missing parent two levels deep is made level by level, and a link planted at the first level stops it.
15. **RW-3:**
    - a path that is now a link is `refused`, and its target is never read;
    - an `include` naming a path the preview didn't list as `changed` is ignored and counted in the log;
    - a `to` from another chat gets 404.

### End-to-end (invented profile, stand-in model)

- **The basic flow:**
  - three replies change files;
  - "Rewind to here" on the first user message;
  - the preview lists the files;
  - confirm;
  - the Changes pane shows the checkpoints marked rewound;
  - "Undo the rewind" works.
- **`new-chat`** opens a fork, and the old chat still has every message.
- **An engine stand-in turn** (`BUNNY_FAKE_ENGINE`) in full mode: its Write is rewound, and its command step gives the warning.
- **Pictures:** desktop and phone, both themes, from Design's drawing.

## 7. Help (O7)

A help section "Go back to an earlier point". It says plainly that what commands changed isn't put back, and that files changed outside Bunny are left alone unless ticked.
