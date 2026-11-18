# SEARCH-PC (v0.1.14, HIGH): Security's requirements, before the owner's go

Source: Design's approval page (repo 5efd9c2, `docs/design/review-v0114-search-pc/`), its "For Security" table, and the owner's wish as the Chief of Staff relayed it. In short:
- "Search this PC" uses the Windows Search index, from Quick ask and the chat.
- A setting chooses "read the files, then answer" or "show what was found".
- The owner: "since its on my system i am not concerned about the privacy".

The owner's words settle privacy toward the owner. They do not settle **secrets leaving the PC**, **other people's files**, or **file text steering the model into actions**. Those are what these requirements are for. Each rule is SP-n, and Builder shows a test for each.

## SP-1: the switch, read-only, the index only

- Off by default. The Settings switch is the only permission, and it is window-only (`isWindowOnlyRoute`), so no device can turn it on at any level.
- The one-time dialog names the model and provider that will get file text.
- Read-only: no tool in this feature writes, moves, deletes, renames or runs anything.
- Only the Windows Search index (`SystemIndex`) is read. No crawling of the disk, no index of Bunny's own, no fallback scan when the index is off.

## SP-2: fixed exclusions, which the person cannot remove, checked on the real path

**Folders.** Always skipped, including every subfolder:
- Bunny's data folder (`BUNNY_DATA_DIR` or `%LOCALAPPDATA%\BunnyAI`), and the folder Electron keeps Bunny's own data in;
- `%APPDATA%` and `%LOCALAPPDATA%` (which hold every browser profile and most password managers), all of `AppData`, and `%ProgramData%`;
- `%windir%`, `Program Files`, `Program Files (x86)`, `$Recycle.Bin` and `System Volume Information` on every drive;
- every other user's profile (`C:\Users\<anyone else>`, `C:\Users\Public` included) and `C:\Users\Default`;
- `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker`, `.config\gh` and `.git` folders anywhere.

**Files, by name or type, anywhere:**
- `.env` and `.env.*`, `.npmrc`, `.pypirc`, `.netrc`, `_netrc`, `.git-credentials`, `credentials`, `credentials.json`;
- `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `id_dsa*`;
- `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.ppk`, `*.kdbx`, `*.kdb`, `*.keychain*`, `*.ovpn`;
- `wallet.dat`, `*.wallet`.

**No network locations.** UNC paths (`\\server\...`) and drives whose type is network are never searched or read.

**Checked twice, on the real path:**
- on every result before it is shown;
- again just before any read or Open.

**How to check:**
- Resolve with `fs.realpath.native`, so junctions, symlinks and 8.3 short names become the long final path.
- Compare case-insensitively, with trailing dots and spaces removed.
- Refuse any path with `:` after the drive letter (alternate data streams), and any `\\?\` or `\\.\` form.
- For the read itself: open the file, then compare the realpath of the opened path again and refuse on any change, so a junction can't be swapped in between.

**The person's own exclusions** are added to the fixed list, never instead of it.

**Secret-looking text never leaves.** Run the existing `looksSecret` check on every chunk of file text before it goes to a model. A file that trips it is reported as "skipped: it looks like it holds a key or password". It is not sent, not saved in `modelResult`, and not shown in a snippet.

## SP-3: file text is untrusted

- File text goes to the model only inside a marked data block that says it is file content, not instructions. Each file is labelled with its name.
- **Quick ask stays text-only.** In the bar the only tools are the search and the read: no others, and no permission prompts.
- **In the chat, the main risk.**
  - Once a turn contains file text read by SEARCH-PC, any tool in that turn that writes, runs, installs, sends or reaches the network needs the person's click, even in Auto. That covers `run_command`, file writes, connectors, `browser_*`, `schedule_task`, memory writes and settings.
  - A file that says "now run X" must stop at a prompt.
  - This lasts for the rest of that turn, and for the next turn too if the file text is still in the context window.
- **Answers that quote file text must not fetch anything by themselves.** No remote images or other auto-loading content in the answer. Links show their full address, and opening one is a click. (Otherwise file text could make the model write an image link carrying a secret in its address.)
- **Caps on a read:**
  - "read then answer" reads at most 3 files;
  - at most 20,000 characters each, reported as "part of the file" when cut;
  - a file is opened at most 8 MB;
  - text is extracted in-process with Bunny's existing PDF and Office extractors. No external viewer or converter is started.

## SP-4: Open never runs a program

- **Open** only for an allow-list of extensions, judged on the realpath (the target, never the link): `.txt .md .csv .log .rtf .pdf .docx .xlsx .pptx .odt .ods .odp .png .jpg .jpeg .gif .webp .bmp .heic`.
- **Everything else** gets "Show in folder" only (`shell.showItemInFolder`). That includes:
  - programs, scripts and installers: `.exe .com .bat .cmd .ps1 .psm1 .vbs .vbe .js .jse .wsf .wsh .hta .msi .msp .msix .appx .scr .cpl .jar .reg`;
  - links: `.lnk .url .library-ms .search-ms`;
  - macro-capable Office files: `.docm .xlsm .pptm .doc .xls .ppt`;
  - local web content: `.html .htm .svg .xml .mht`.
- **Never "Open with"**, never a verb other than the default `shell.openPath`, and never a path that failed SP-2.
- **Open, Show in folder and Copy path** work only from Bunny's window and the bar (sender checks as `fromOwnFrame` and `fromBar`). A device never opens anything on the PC, even at Everything: the device's page shows the list without those buttons.

## SP-5: devices

- **Chats-level devices are refused.** The search and read tools join `REMOTE_TOOLS_DENIED`, so the server refuses them by default, whatever the page sends.
- **Everything-level devices may search and read,** as the window can.
- Every device search and read is in the device action log (R-DF2).

## SP-6: the Activity record

- Each search is logged as "Searched this PC · N results".
- Each read is logged as "Read N files" with each file's name and folder. Never file text.
- **The query itself is not logged.** If Design wants a label, it is at most 40 characters, and the search terms are never logged when the chat is incognito.
- The record is window-only, kept like the action log (last 500 entries or 30 days), and shows window and device searches alike, each saying who asked.

## SP-7: building the query, caps and time

**Query text and columns.**
- The question never becomes query text directly. Bunny, or the model's tool call, produces at most 8 terms.
- Each term:
  - is at most 64 characters;
  - is reduced to letters, digits, spaces and `- _ .` (Unicode letters allowed);
  - is put inside single quotes with any single quote doubled;
  - has the LIKE wildcards `%`, `_`, `[` and `]` escaped.
- Dates and kinds come from fixed choices, never free text.
- The SQL is a fixed template: fixed columns (`System.ItemPathDisplay`, `System.ItemName`, `System.DateModified`, `System.Size`, `System.Search.AutoSummary`), `SCOPE='file:'`, `TOP 50`. Exclusions apply in code afterwards, and may also be added to the query.

**The process that runs it.**
- PowerShell from `powershellPath()` with `safeEnv`.
- The terms go in through environment variables or stdin, never on the command line.
- The script is a fixed string in the code.

**Time.** 10 s per search. On timeout the process tree is killed (`taskkillPath()` with `/T /F`) and the person sees "Windows Search did not answer in time".

**Limits.** One search at a time per chat or bar. At most 5 searches per turn. Results capped at 50 rows; 8 shown, the rest behind "Show more".

**Snippets.**
- Snippets come from `AutoSummary` and are cut to 200 characters.
- They are shown as text (`textContent`), never as HTML. Matches are marked by splitting the text, never with `innerHTML`.
- In "show what was found", snippets are **not** sent to the model, only names, folders and dates, as the page says.

## SP-8: what gets saved

- A file text read in a normal chat may be kept in the saved chat (`modelResult`, at most 8,000 characters, after SP-2's secret check). In an incognito chat, nothing.
- The bar keeps nothing after it closes, as today.
- Nothing from a search is added to Memory automatically.

## The owner's questions on the page

Security has no requirement on which choice is pre-selected. Either is acceptable with SP-1 to SP-8. If the owner chooses "read then answer", SP-2's secret check and SP-3's chat rule matter most, so they get the most tests.

## Release gate

Security signs SEARCH-PC only with:
- a test per SP item;
- a probe of a junction from an allowed folder into `.ssh` and into Bunny's data folder (both refused, on result and on read);
- a probe of a file whose text says to run a command, in the chat on Auto (it must stop at a prompt);
- a probe of an `.exe` and of a `.lnk` pointing at an allowed `.txt` (Show in folder only for both);
- a probe of a quote in a search term (no query error, no other rows).
