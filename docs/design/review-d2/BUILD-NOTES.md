# D-2 build notes (for Builder)

Source of truth: `index.html` in this folder (toggle Light/Dark and 1440/390; the states board under section 1 shows every state). T-3 lines come from `../review-t3/index.html`. English only. Colours are tokens only (`--accent`, `--ok`, `--bad`, `--run`, `--line`, `--hover`, `--bg-sidebar`, `--text-dim`); no new colour. Keep every id and class listed under "Must keep" (lesson L005). Build order: 1 transcript, 2 Session pane, 3 Changes, 4 Files (3 and 4 need new read-only endpoints; Security looks first). Evidence back to Design (O8): invented-profile shots, light and dark, 1440 and 390, of each state below.

## 1. Chat transcript (`src/ui/chat.js:978-1005` renderMessage tool block, `:1453` stepNote, `:1460-1480` live tools, `:1646-1662` undo bar; `src/ui/app.css:1149-1155, :1495, :1767`)

Today: each tool call is one `.msg.assistant > .tool-call` row (header = tool name + status tag, body, `→ result`). Five steps are five rows.

Proposed rules:
- **Group line.** Consecutive tool steps between two pieces of narration render as ONE group: a line with a chevron, a plain past-tense summary, and on the right either a dim meta (elapsed, or `+4 −1` for edits) or the red label. Group lines are collapsed by default once finished.
- **Summary wording** (past tense, counts in words under ten): "Read a file", "Read 3 files", "Read a file, tried to read another", "Wrote a file, edited a file", "Ran a command", "Searched for a word", joined with commas, in the order the steps ran, same verb repeated as a count ("Read 3 files, searched for a word"). Failed steps use "tried to …" in the summary. While running the summary is present participle: "Running a command…". Never show the raw tool id.
- **Sub-rows.** Opening a group shows one sub-row per step, named for its target: "Read src/app.js", "Run npm test", "Write src/app.test.js", "Edit src/app.js", "Search for \"greet\"". Each sub-row has its own chevron and opens to its detail: for a command a header line "Command · exit code N · 2.1s", the command in mono, then output; for a read the path; for an edit the path and a small diff. The existing `.tool-call-body` and `.tool-call-result` text becomes that detail (same text, same `resultLimit()`), so nothing is lost.
- **Failed.** A failed step gets a red `Failed` label (`--bad`) on its sub-row, and the group line shows `1 failed` (several steps) or `Failed` (one step). A failed group is collapsed by default, EXCEPT the last failed step of a reply that ended on it, which starts open. The failed detail shows the exact command and the error in a mono block with a Copy button (copies command + error).
- **Narration** (`stepNote`, model sentences between steps) stays as plain text between groups, no box, normal body colour.
- **Reply** is plain prose, no box (as today's `.body`).
- **Running.** The group line stays open with a small spinner on the live step; the existing purple bunny line (`.bunny-working`, word and seconds) sits under the last group, unchanged. Running detail header reads "Command · running".
- **Stopped by the person.** A report, not silence: heading "Stopped", one line "You stopped Bunny after N steps.", a "Done:" list, a "Not done:" list, buttons `Continue` (primary) and `Undo these changes`. "Done" is what the steps already ran; "Not done" is the remaining plan items if known, otherwise omit that list.
- **Model fallback (T-3, d411cda / 1ea3eec).** Use the exact confirmed strings from `../review-t3/index.html`: meta line under the reply "Answered by {to} because {from} …" plus the reason, second failure adds " (1 other model also failed)"; the live line "{from} {reason}. Trying {to}…" at the switch; part-way "{from} stopped part-way. {to} carried on from there." This stays one dim line, never an error box. The built strings name the picker's real models.
- **Reply that failed outright** (`kind:'error'`, now `.msg.error-note`): same red `Failed` label on a group line "The reply failed", opens to the provider error with Copy, then buttons `Try again` and `Choose another model`. Keep the `.error-note-text` element with the same text inside it.
- **Kept unchanged:** permission prompts (`.permission-prompt`), question cards (`answeredQuestionCard`), artifact and linked-chat cards, attachments, thinking blocks, the msg actions row.
- **Phone:** same structure; detail blocks wrap (`overflow-wrap: anywhere`); a group summary never truncates, only sub-row names may.

Must keep (tests rely on them): `.msg`, `.msg.user .body`, `.msg.assistant .body` (the reply text, last one), `.msg.assistant .msg-actions button[data-act=…]`, `.msg.assistant .auto-meta` (read by `e2e/cards.spec.js:148` for the Auto line text), `.msg.assistant details.thinking`, `.msg.assistant .task-list .task-item`, `.tool-call-result` (`e2e/cards.spec.js:110` expects its text to be `→ Opened in the Artifacts panel.`, so the arrow text stays on that element), `.bunny-working .bunny-word` and `.bunny-working .bunny-time` and `.bunny-working` removal when done, `#messages .msg` count, `.attachment-file`, `.attachment-image`, `.undo-bar`, `.step-note`, `.live-tool`, `.error-note` / `.error-note-text`, `data-id` on `.msg`. If a group wraps several `.msg` rows, keep each tool step's own `.msg` wrapper (or run the e2e files above and fix selectors in the same commit with a note to QA).

## 2. Session pane (`src/ui/index.html:261-286`, `chat.js:1267-1330` renderRail, `src/server/processes.js`, `usage.js`)

Keep `#rail`, `#rail-toggle`, `#rail-project`, `#rail-connectors` (with `.rail-empty` "No connectors yet"), `#rail-outputs`, `#rail-context-text`. Replace the Environment block with groups, each an `h5` + `.pane-row`/key-value rows (`.k` dim 92px, `.v`):
- **Where:** Folder (name, full path small, "Open in Explorer"), Branch (name, "N files changed, not committed").
- **Model:** the model; one line why Auto picked it ("Auto picked this: a small edit, so the faster model", only when Auto chose); Effort.
- **Context and cost:** percentage and "76k of 200k tokens" with the existing meter; "41k in · 6k out" for this chat; cost "est. 0.00" only if the provider reports usage, otherwise the words "not reported" (never a guess).
- **Connectors:** a dot per connector (ok / off), as today plus the dot.
- **Running programs:** from the existing process list, name, port, age, `Stop` button.
- **Outputs:** as today.
No folder: "No project" row stays (the e2e expects `No project`).

## 3. Changes pane (`src/ui/index.html:312-315` `#pane-diff`, `#diff-content`, `#pane-diff-refresh`; `src/server/checkpoints.js`; NEW read-only endpoint)

Today nothing writes into `#diff-content`; it always shows "No changes yet." Proposed: header "Changes" + badge "N files" + total `+N −N`; tabs "This session" / "Since checkpoint" (git folders may add "Since last commit"). One card per checkpoint (after each edit step): head "Checkpoint N after Edit src/app.js" with `Undo to here`; rows with the path in mono, badge `new` / `edited` (accent-soft), `+N −N` in `--ok` / `--bad`; the expanded file shows a unified diff (added lines `--ok-soft`, removed `--bad-soft`, hunk header `--bg-sidebar`, line numbers dim). `Undo to here` opens a confirm that names what will be restored and removed ("Restores src/app.js and removes src/app.test.js") with `Undo 2 files` / `Keep`. Non-git folders: the same cards built from the pre-edit copy Bunny already saves; one banner sentence says so. Empty state keeps the text "No changes yet." (class `diff-empty`). The endpoint is read-only: it returns the checkpoint list with before/after text per file; it writes nothing and only reads inside the session folder (Security reviews path escapes).

## 4. Files pane (`src/ui/index.html:354-356` `#pane-file`, `#file-content`; NEW read-only listing and file-read endpoints)

Folder tree of the session folder (folders open/close), the open file below with line numbers. Files Bunny edited or created this session are tinted `--accent-soft` with "edited 2m ago" / "new 3m ago"; the lines it changed carry an accent left bar. Clicking "Read src/app.js" in the transcript opens that file here. Header: folder name, `Copy path` on the file header. Read-only, no editing. Empty state keeps "Open a file to read it." (`file-empty`). Phone: tree first; opening a file shows the file with a back row.

## 5. Shared pane chrome

Desktop: panes sit at the right of the thread as today; phone: a pane replaces the thread with a head "Close" button. Pane toggles in the chat top bar keep their ids.

## Decisions already taken (Chief of Staff, under the owner's delegation)
Group per run of steps; failed collapsed unless the reply ended on it; Changes in non-git folders uses the saved pre-edit copies; Files pane read-only; build order as above.

## Risks
Transcript: MEDIUM (renderer every chat uses, test ids above). Session: LOW to MEDIUM. Changes and Files: MEDIUM each (new endpoints reading the session folder; Security to review). Design signs off each piece against the artifact from invented-profile shots.
