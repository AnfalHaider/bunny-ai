# Security rulings at 260cb5de: G2 judge skip, F4 curated list, links in write paths (2026-11-25)

Asked by the Chief of Staff, from Tech Lead's cross-check at 260cb5de. Read from the code at that sha; no tests run for this note.

## 1. G2 / F11: edits inside the folder skip the Auto judge (`app.js:4219`)

The `!(isWorkspace && risk === 'edit')` clause means no edit inside the folder goes to the judge. That includes files that run later: `package.json` scripts, `.github/workflows/*`, `*.ps1`, `*.bat`, `*.cmd`, `Makefile`, `.vscode/tasks.json`. The `.git` folder is already refused (W6-NEW-1).

**Ruling: not a blocker for v0.1.15. It must be in the release notes, and the fix goes to v0.1.16 as HIGH.**

- **Not a regression.** Before F11, Auto ran every edit inside the folder with no check at all. Auto still needs a git folder the person trusts (F12), so every edit shows in Changes and can be undone.
- **Why it matters.** The judge sees the command (`npm test`), not the script an edit just put behind it. So an injected edit followed by a harmless-looking command gets past the check.
- **Release note text (plain):** "In Auto, Bunny's check looks at commands, connectors and installs. It does not look at edits to files inside your folder. If a chat edits a script and later runs it, the check sees only the command. Review the Changes tab before you run project scripts."
- **v0.1.16 fix (G2-1):**
  - Send edits to run-later files to the judge, as Tech Lead's spec says (at least the list above).
  - When a command runs a script that was edited earlier in the same reply, give the judge that edit as well.

## 2. F4 curated connector list (`src/server/curatedPlugins.js`)

I checked each entry for: an https address on the vendor's own domain; no local program; the add path unchanged (`add_connector`, arrives OFF, the person is asked, only the window switches it on). Addresses and sources match `docs/plans/curated-connectors-sources.md`. The URLs were checked by Researcher on 2026-11-20; I did not fetch the vendor pages again.

| Entry | Ruling |
|---|---|
| Notion, Linear, Sentry, Atlassian (v2), Context7, DeepWiki, Microsoft Learn | PASS |
| Stripe | **DROP for v0.1.15** |

- **Why Stripe is dropped (F4-1).** A remote connector's tools are risk `run` unless they are read-only (`app.js:4118`). In Auto, `run` gets no card, only the judge (`needsOk`, `app.js:2753`). So a Stripe refund, charge or subscription change could happen with no person looking. Money is HIGH under AGENTS.md. Bunny should not be the one recommending a money connector until such tools get a card in every mode.
- Stripe can come back after one of these: write tools of a payments connector (or any connector the person marks "money") are risk `send`; or Stripe is listed read-only.
- The line the model sees ("checked by Bunny's team against each vendor's own documentation") holds, given the sources file. Keep the sources file updated with each release.

## 3. Links in the write paths: `inside(path, {mustExist:false})` (`workspace.js:253-280`)

Confirmed. With `mustExist:false`, only the nearest existing parent is resolved. If the target already exists as a symbolic link, or as a link that points nowhere, `writeFile` follows it out of the folder. All four callers are affected: `workspace.js:531, 543, 569, 580` (write_file and the make_* tools). `isProtected` also runs only on the spelled path in this branch, so a link can reach Bunny's data folder.

- **How it happens.** A cloned repository can carry symbolic links (git on Windows with `core.symlinks`). A file in it named like `notes.md` can point at the Startup folder or Bunny's data folder.
- **What it allows.** In Accept or Auto, a write inside the folder gets no card and no judge (item 1). So one injected `write_file` writes outside the folder, which can mean code running at the next sign-in.

**Ruling: fix in v0.1.15 (S-LINK-1, HIGH).** It escapes the folder, it needs no card, and every installed copy has it since 8889a54e.

**Required fix:**
1. In the `mustExist:false` branch, `lstat(target)`.
   - Refuse a symbolic link or junction, including one that points nowhere ("is a link; Bunny does not write through links").
   - If the target exists and is not a link, `realpath` it. Then apply the same `isProtected` and inside-the-root checks as `mustExist:true`.
2. Apply `isProtected` to the parent's real path as well.
3. Tests, in an invented profile:
   - a link to a file outside the folder;
   - a link that points nowhere;
   - a link to the data folder;
   - a junction parent (still refused);
   - a normal new file and a normal existing file (still written).
   - Cover write_file and every make_* tool.
4. Note for later, not required now: an NTFS hard link (`nlink > 1`) is not caught by `lstat`. Git does not create hard links, so this is v0.1.16 hardening.

This tightens a security control. Under AGENTS.md, a HIGH change needs the owner's go, an independent review, and my sign-off on the fix sha. I will review the fix when the sha arrives.
