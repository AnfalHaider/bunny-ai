# SEARCH-PC, a77be4d (Security): PASS against SP-1 to SP-8

Branch claude/builder-b-search-pc. I read the SEARCH-PC commits 49d8360..a77be4d on top of main efcd305 and WEB-ACCESS 5e980fd (signed at 75912d6):
- `pcExclusions.js`, `pcSearch.js`, `pcService.js`, `pcTools.js` and `pcActivity.js`;
- the `app.js`, `chat.js` and `markdown.js` changes;
- `electron/pc-open.js`, the preloads and the bar.

On an extract of a77be4d with an invented profile:
- the 9 `pc-*` test files and `window-only` pass **72 of 72**;
- my probe (`docs/security/search-pc-probe/probe.mjs`, temp folders and junctions only) results are below.

## Requirement by requirement

**SP-1: the switch, read-only, the index only.**
- The four settings are window-only (`WINDOW_ONLY_SETTING_KEYS`). Any device sending them gets a 403, **Everything included** (an explicit check in the settings PUT).
- They're type-checked, and personal folders are resolved to real folders.
- Search uses `SystemIndex` only. No disk walk anywhere. When the service is off, it's reported as off.

**SP-2: exclusions on the real path, checked twice.**
- The fixed folders are the data folder, Electron's data, APPDATA, LOCALAPPDATA, ProgramData, Windows and the Program Files folders. Each is taken both as written and resolved through `realpath.native`.
- The key folder names apply at any depth. The root recycle-bin and system folders are refused, and so is every other user's folder.
- File patterns are excluded as listed. The person's list adds to all this.
- These are refused: UNC and `\\?\` forms, alternate data streams, and drives whose type is network or unknown (except the system drive).
- `readAllowed` opens the file, checks the realpath again, and refuses on any change.
- The probe:

      ordinary file                            ALLOWED
      junction into .ssh                       refused: a folder that holds keys
      junction into the data folder            refused: Bunny or Windows keeps its own data here
      junction into another person's folder    refused: another person's folder
      a .git config                            refused: a folder that holds keys
      trailing dot spelling of .ssh            refused: it cannot be resolved
      alternate data stream                    refused: an alternate data stream
      UNC form                                 refused: a network or device path

- `textLooksSecret` runs over the whole file in 4 KB chunks, and a match skips the file whole. Snippets get the same check.

**SP-3: file text is untrusted.**
- File text goes in a marked block. Its end marker carries a per-reply nonce, and a copy of the marker inside the file is defused, so a file can't close its own block.
- **The chat rule:** once a reply holds file text (`pcTurn.tainted`, and `holdsPcFileText(history)` for the next replies), every tool except the five taint-free ones and workspace `read` tools goes through `askPermission`, **in Auto too**. That includes `read_url` and `web_search`, which could carry text out. Builder B's taint test covers "a file says run a command" in both the same reply and the next.
- **The bar:** after a file read, web look-ups are refused outright, since the bar has no card to ask with.
- **Answers:** an answer from a tainted reply renders with `noAutoLoad`. An image shows as its alt text and address (escaped text), and a link shows its full address.
- **Caps:** 3 reads per reply, 8 MB opened, in-process readers only (no `.doc`, `.xls` or `.ppt`, no web pages).
- **The deviation is accepted:** three files share one 44,000-character budget (20,000 each for one or two, about 14,600 each for three). Every file stays within SP-3's 20,000.

**SP-4: Open never runs a program.**
- Open, Show and Copy are **IPC only**, with no server route.
- The sender must be an own page (`isOwn`) or the bar (`fromBar`).
- The argument is a **ref** of at most 80 characters, never a path. The main process resolves it through `/api/pcsearch/resolve`, which is admin-secret only. The path is judged again on its real path.
- Open uses `shell.openPath` only for `OPEN_ALLOW` on the real path, so a `.lnk` stays `.lnk` and gets Show in folder. Everything else gets `showItemInFolder`. Builder B's test covers `.exe` and `.lnk`.

**SP-5: devices.**
- `search_pc` and `read_pc_file` are in `REMOTE_TOOLS_DENIED`. The chat offers them only when `!req.bunnyRemote`, so a Chats device never gets them, and an Everything device may use them, as the window can.
- `/api/pcsearch/*` is refused to every device.
- The bar's tools need the admin secret plus `pcSearch` in the request (`barPc`).

**SP-6: the record.**
- `pcsearch-activity.json` holds who asked, the kind, the count, file names and folders, and a label of at most `LABEL_CHARS` cleaned from the terms. Incognito gives an empty label. No file text is kept.
- It's readable at `GET /api/pcsearch/activity`, window-only.

**SP-7: the query, caps and time.**
- At most 8 terms of 64 characters each, cleaned to letters, digits, space and `- _ .`.
- Quotes are doubled and LIKE wildcards escaped. The template, columns, `SCOPE='file:'` and `TOP 50` are fixed, and kinds and dates come from fixed lists. The probe's `tax' OR 1=1 --` comes out as the harmless text `tax OR 1 1 --` inside quotes.
- PowerShell is started by full path with `safeEnv`. The SQL goes in an environment variable, and the script is a fixed string.
- Limits: 10 s, then the tree is killed with `taskkillPath /T /F`. 1 MB of output, 50 rows, one search at a time per chat or bar, 5 per reply.
- Snippets are 200 characters, shown with `textContent` and `<mark>` built from text nodes. They're never sent to the model; the model gets names, folders and dates.

**SP-8: what is kept.** A read is saved only as `fullResult` with `saveable: !incognito`. Search steps keep names, folders and dates, not snippets. Nothing goes to Memory.

## Notes (LOW, not blocking)

- **SP-L1:** a `subst` drive letter, or an NTFS hard link to a file inside an excluded folder, reaches that file under an allowed path. `realpath` doesn't resolve either, and the index rarely includes them. Setting either up takes the same Windows user. The file-name patterns and `textLooksSecret` still apply. If it's cheap, also judge the path `GetFinalPathNameByHandle` returns, through the handle opened for the read.
- **SP-L2:** the "next reply" rule depends on the marker still being in the history Bunny sends. If compaction ever cuts a block's start but keeps the text after it, the next reply would lose the rule. Keep the marker with any shortened block.

## Verdict

PASS at a77be4d. The **Sources chips and the bar's states are still to come**, and I'll read them when they land, with the same checks: text-only rendering, refs only, and nothing that loads by itself.

## Re-review at c051ca5: PASS (supersedes a77be4d)

Commits since a77be4d: 0b55f15 (the Sources chips, the [n] marks, the bar's states) and c051ca5 (the QA smoke script, Settings text). The tools' rules are unchanged: exclusions, taint, refs, devices and caps.

- **Sources.**
  - Each read block carries `source="n"`, a number from Bunny's own counter.
  - The saved answer carries `pcSources` = `{n, name, folder, part, ref, openable}`: no text and no path beyond the folder SP-8 already keeps.
  - `markSourceNumbers` walks text nodes, skipping `code`, `pre` and `a`. It turns only `[n]` with 1 ≤ n ≤ the number of sources into a `<b>` built with `textContent`. No HTML is inserted.
  - Chips open by **ref** through the existing guarded IPC, and are plain spans where there's no desktop bridge, such as on a device.
- **The bar's states.**
  - The answerer passes only fixed fields with lengths cut. States outside the fixed list are dropped. No path or file text reaches the bar.
  - Every state renders with `textContent`.
  - The new bar target `search-settings` only opens Settings on Capabilities, and still sits behind `fromBar`.
  - "Search this PC is off" is answered in the bar from a local pattern, with nothing sent.
- **Devices.** `pcSources`, like `pcResults` before it, is part of the saved chat. A device the owner signed in can read chats, so it sees file names and folders from window searches. It can't open them (no bridge) or search itself at Chats. This is accepted as the same exposure the chat already has.
- **The smoke script** (`scripts/pcsearch-smoke.mjs`, QA's, not run by Security):
  - It writes three invented files into a new `Documents\bunny-pcsearch-smoke-<6 hex>` folder and queries the **real** index for a random unique word.
  - It deletes only that folder, guarded by "direct child of Documents and matches the name".
  - `--dry` prints the plan and touches nothing (checked).
  - **Running it writes into the owner's real Documents folder and uses the real index.** That's outside the invented-profile rule, so QA should run it only with the owner's OK, on the owner's PC.
- **My probe** on c051ca5 gives the same refusals as at a77be4d.
- **Tests:** the pc-* files, `pc-smoke`, `window-only` and `quick-ask` pass 91 of 91 on an extract.

Verdict: PASS at c051ca5. SP-L1 and SP-L2 still stand as LOW notes.

## Re-stamp at b5c3c72: PASS (supersedes c051ca5)

- b5c3c72 touches only `scripts/pcsearch-smoke.mjs` and adds `test/pc-smoke.test.js`.
- Without `--i-have-the-owners-ok`, the script names the exact folder it would create and delete, then exits 2. The check runs after `--dry` and before any write (line 31, ahead of `mkdirSync` at line 41).
- Run here without the flag, it printed "REFUSED: … needs the owner's own OK", exited 2, and created nothing.
- `pc-smoke` passes 2 of 2.
- The flag is the script's own guard. The owner's OK still has to be asked for, and recorded, before QA passes it.

Verdict: PASS at b5c3c72.
