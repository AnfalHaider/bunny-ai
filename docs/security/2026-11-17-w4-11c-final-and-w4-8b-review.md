# W4-11 final (`w4-11c` @ c5082f5) and W4-8b (`w4-8b` @ 3cb6368): Security review

## w4-11c at c5082f5 (`claude/builder-a-w4-11-main`): PASS, supersedes the FAIL at cd13666

**Rebuild check.** The cherry-picked series on main 4995d5f (up to e80b64d) equals what I reviewed at cd13666 plus main's own changes. The `--stat` of `cd13666..e80b64d` matches `merge-base..4995d5f` file for file. The only differences are in `src/server/chat.js` and `src/ui/app.css`, and they are W4-11's own lines (`onToolsRefused`) sitting beside main's wait-time change.

**P6-1 fixed (9c9a40d, 8aca3c0).** `add_skill` saves the skill with `enabled: false` in every mode. The `switch_on_added` card holds the title, the description, the whole instructions and a footer. That length is counted exactly, and over 1,800 characters the skill is refused, never cut. My probe `docs/security/p6-probe/zz-p6-addskill.test.js` at c5082f5:

```
auto:   cards=["capability"]  /api/skills -> evil enabled:false
accept: cards=["capability"]  /api/skills -> evil enabled:false
```

**The five LOW findings are fixed.**
- P6-2: what was added is kept per chat (`pendingByChat`).
- P6-3: the tool descriptions say OFF.
- L5-1: a `cwd` change needs `confirmLocal` and drops trust.
- L4-1: plain values left by a failed migration are moved to the store when it works, and are never deleted otherwise.
- L3-1: trust is now a snapshot, `server.trustedTools` (name → label at the time of trusting). `isReadOnlyTool` needs the tool in the snapshot with the same label. A new tool, or a label that changes to read-only, is outside the trust, and so is a connector that has not listed its tools (`mcp.listFirst`). A changed address or command clears the snapshot. Trust records from before this change have no snapshot, so their tools count as may-write: the safe direction.

**New parts.**
- **D-2.** Pictures from a connector go only to a model that can see: at most 2, png/jpeg/gif/webp, base64 checked, at most 4 MB each. They are untrusted content, like the connector's text.
- **P-4.** `POST /api/plugins/<id>/update` is window-only (in the table). New connectors arrive OFF, connectors at the same address are kept with their trust and sign-in, and removed ones are stopped and signed out. The person's own skills and connectors are never touched.
- **P-2.** Commands and agents become skills, inside the limit of 40. When the model installs a plugin they arrive OFF, like every other part.

**Tests at c5082f5, one file at a time:** 113 of 113 across 22 files. sec-b2 10, p6 6, l4 7, ro1 5, misc 4, pv-tools 10, window-only 16, plugins 2, local-mcp 4, fixes 3, l5 2, l3 2, d3 2, s4 2, qa 5, d2 3, p4 3, p2 3, c 7, d 9, p1-p3 2, r2-l1 6.

**Note, LOW, not blocking.**
- **P4-1.** An update from the window rewrites the instructions of a skill that is ON without showing the new text, and new skills arrive ON when the plugin's skills were all on. The person asked for the update in the window, the same consent as installing from Customize. Better: list the changed skills with their new length, and switch on only after a yes.

## w4-8b at 3cb6368 (`claude/builder-a-w48b`): PASS

All six design changes are in (776d291).
1. **The bytes stay in main.** Main holds `{ id, file }` under a random id. The page gets the id, name, kind, size and a preview (a picture up to 200 KB only), and submits `{ kind: 'file', id }`. `validateSubmission` takes the held file only when the ids match. The held file is dropped on ×, when the bar closes, and once sent. Nothing is read again at send.
2. **One read, one handle.** lstat refuses links and anything that is not a file. Then open, the handle's own stat, and a read of at most 8 MB + 1. A file that grew while being read is refused.
3. **Paths.** `checkPath` refuses anything starting with two slashes. Probe: `\\server\s\a.txt`, `\\?\C:\a.txt`, `\\.\PhysicalDrive0` and `//srv/a.txt` are refused; `C:\a.txt` is allowed.
4. **Secrets.** The extension list is written out in full, plus a list of extensions and names that are never attached. `looksSecret` runs on text. Probe: `.env`, `.env.local`, `ID_RSA`, a `.json` holding an `sk-ant-` key and a `.txt` holding an RSA private key are all refused.
5. **Names.** Control and `\p{Cf}` characters are removed. `photo<U+202E>gnp.exe` loses the override character, ends in `.exe`, and is refused as a kind that cannot be added. The mime is set in main.
6. **Content checks.** An MZ file named `.png` and a NUL byte in a `.txt` give "not what its name says".

IPC: `quickask:pickFile` and `quickask:dropFile` use the same `fromBar` check as the screenshot call. Only the native dialog gives a path.

`.svg`, `.html` and `.xml` are accepted as `text/plain` text. The chat shows a text attachment as a card whose name is set with `textContent` (`src/ui/chat.js` `renderAttachments`), so nothing is rendered as markup.

**Tests:** `quick-ask-file` 10 of 10 and `quick-ask` 15 of 15, run one file at a time. e2e was not run (single-file rule).

**Accepted residual.** A file on a mapped network drive letter (`Z:\`) passes `checkPath`. The person mapped that drive, and Windows already holds the connection.
