# OFFICE-MAKE: Bunny creates Word, Excel and PowerPoint files

Tech Lead, 2026-11-20. Plan item D in `docs/plans/2026-11-20-v0.1.15-plan.md`. Risk: MEDIUM (a dependency change and a new write path). Security reviews the libraries and the write path before it merges.

## Today

- Bunny **reads** .docx, .xlsx and .pptx (`src/server/documents.js` `readDocument`).
- Nothing in `src/` **writes** them. The only runtime dependency is `unpdf` (`package.json`).

## 1. Libraries (measured, not guessed)

These were installed with `--ignore-scripts` in a scratch folder, outside the repo:

```
npm i --ignore-scripts docx@9.15.3 write-excel-file@4.1.1 pptxgenjs@4.0.1
```

| File | Library, exact pin | Licence | Runtime deps | Last release |
|---|---|---|---|---|
| .docx | `docx@9.15.3` | MIT | fflate, nanoid (+ @types/node, types only) | 9.15.3 on 2026-11-06. 9.16.0 is one day old, so it isn't taken. |
| .xlsx | `write-excel-file@4.1.1` | MIT | fflate | 2026-06-08 |
| .pptx | `pptxgenjs@4.0.1` | MIT | jszip (pako, lie, readable-stream…) | 2025-06-26 |

### Checks

- **Pure JS, no native build.** No package in the tree has an install, preinstall or postinstall script (checked with grep over every `package.json`).
- **Size.**
  - The new tree is 22 packages, 34.5 MB unpacked and 7.9 MB as a tar.gz.
  - `docx` alone is 20 MB, because it ships six builds plus types. The one Bunny loads, `dist/index.mjs`, is 1.0 MB.
  - Builder trims the installer in `package.json` `build.files` with:
    - `!node_modules/docx/dist/*.{iife.js,umd.cjs,d.ts,d.cts}`;
    - `!node_modules/**/*.map`;
    - `!node_modules/@types/**`;
    - `!node_modules/pptxgenjs/dist/pptxgen.{bundle,min}.js`.
  - Builder records the installer size before and after in the PR.
- **Audit: one finding, and the fix.**
  - `npm audit` on the plain install reports 2 HIGH, both in `image-size@1.2.1`, a dependency of pptxgenjs: GHSA-5p2g-fcmc-qvqq and GHSA-w3rx-r6r6-pgpr (denial of service through a crafted image).
  - pptxgenjs never loads it. Its only `require` at run time is `jszip`, and the one image-size call is commented out (`dist/pptxgen.cjs.js` ~line 5015, "FIXME: TODO: currently unused").
  - With `"overrides": { "image-size": "2.0.3" }` in `package.json`, `npm audit` reports **0 vulnerabilities**, and the smoke run still makes all three files.
  - So: **pin the override**, and add no owner exception.
- **One oddity for Security.**
  - pptxgenjs lists `https@1.0.0`, a placeholder npm package (ISC, a `package.json` and no code).
  - `require('https')` always resolves to Node's built-in module, so the placeholder is never loaded. It stays in the tree because npm installs it.
- **Licences.** All MIT or ISC. `jszip` is "MIT OR GPL-3.0-or-later" and Bunny takes it under MIT. `pako` is MIT and Zlib. Librarian adds them to the licence list in About.
- **Smoke run.** Using invented content, one file of each kind took 82 ms in all: docx 9.6 KB, xlsx 2.9 KB, pptx 46.7 KB.
- **Round trip.** Bunny's own `readDocument` reads all three back:
  - Word: `# Invented report / Bold and plain. / | a | b |`;
  - Excel: `--- Sheet: Sheet1 --- Name Amount / Tea 3.5`;
  - PowerPoint: `--- Slide 1 --- Invented deck / a / b`.
  - That read-back is the core of the tests below.

### Rejected

- **`exceljs`:** 9 dependencies, including `archiver`, `unzipper` and `tmp`, and no release since 2024-12.
- **`xlsx` (SheetJS) on npm:** stuck at 0.18.5, which has known advisories; newer builds are only on their own CDN.
- **One home-made zip writer for all three:** more code for Bunny to own than the three small libraries.

## 2. Loading

- The libraries load only when one of these tools runs: `await import('docx')` and so on, inside a new `src/server/officeMake.js`. Start-up time doesn't change.
- Building a file runs in a `worker_threads` Worker with:
  - `resourceLimits: { maxOldGenerationSizeMb: 512 }`;
  - a 30 s limit, after which the worker is terminated.
- That way, a huge request can't freeze Bunny's server. The worker gets the checked arguments and image bytes and returns one Buffer. It never touches the disk.

## 3. Tool shapes

There are three tools, so each schema stays small and models choose well. All inputs are JSON. Nothing is HTML or raw XML.

### Inline text in every text field

- Plain text, plus `**bold**`, `*italic*` and `[label](https://…)`.
- A link must be `https:` or `mailto:`; anything else is written as plain text.
- No other markup is read.

### `make_word`

```
{ path: string (ends .docx),
  title?: string,                       // document properties
  blocks: [                             // at most 5,000
    { type: "heading", level: 1..4, text }
  | { type: "paragraph", text, align?: "left"|"center"|"right" }
  | { type: "bullets", items: [text], numbered?: boolean }      // at most 500 items
  | { type: "table", rows: [[text]], header?: boolean }         // at most 200 rows x 20 columns
  | { type: "image", path, width_cm?: 1..17 }                    // Code mode only, see §5
  | { type: "page_break" } ],
  overwrite?: boolean }
```

### `make_excel`

```
{ path: string (ends .xlsx),
  sheets: [                             // at most 50
    { name: string (1-31 chars, no []:*?/\),
      rows: [[cell]],
      column_widths?: [number],         // characters, 1..100
      freeze_header?: boolean } ],
  overwrite?: boolean }
```

A cell is one of:

- `string`, `number`, `boolean` or `null`;
- `{ value, type?: "text"|"number"|"date", format?: string, bold?: boolean }`;
- `{ formula: string }`.

Rules for cells:

- **Text is always text.** A string that starts with `=`, `+`, `-` or `@` is written as text, never as a formula.
- **A formula exists only through `formula`.** It is refused if it names any of these:
  - `WEBSERVICE`, `FILTERXML`, `HYPERLINK`, `CALL`, `REGISTER`, `RTD`, `IMPORTDATA`, `IMPORTXML`;
  - a DDE form (`|` or `!` after a program name);
  - an external workbook (`[`).
- That keeps a made sheet from fetching an address or running something when it is opened.
- Builder confirms how `write-excel-file` writes a formula (its `type: 'Formula'`) and records it in the PR.

### `make_powerpoint`

```
{ path: string (ends .pptx),
  title?: string,
  slides: [                             // at most 200
    { title?: text,
      bullets?: [text],                 // at most 30
      text?: text,
      table?: { rows: [[text]], header?: boolean },   // at most 30 rows x 10 columns
      image?: { path },                 // Code mode only, see §5
      notes?: text } ],
  overwrite?: boolean }
```

The slides are 16:9 with one plain theme: Bunny's fonts and the light colours. Design picks the colours from the tokens; this spec doesn't.

### Results

- **What the model gets back:**
  - `Made <path> (Word, 12 blocks, 14 KB)`;
  - `Made <path> (Excel, 2 sheets, 340 cells, 9 KB)`;
  - `Made <path> (PowerPoint, 8 slides, 120 KB)`.
- **The step line** (`describeToolCall`): `Make Word file <path>`, `Make Excel file <path>` or `Make PowerPoint file <path>`.

## 4. Where files go, and which write path

### Code mode (a chat with a folder)

- The tools are workspace tools in `src/server/workspace.js`, with `TOOL_RISK` set to `'edit'`, like `write_file`.
- **The path** goes through `insideEdit(path, { mustExist: false })`. That means:
  - it must be inside the folder;
  - never `.git`;
  - no `..`, no absolute path, and no link that leads out;
  - the protected paths (the data folder) are refused.
- **The extension** must match the tool. `report.docx.exe` is refused.
- **An existing file** is refused unless `overwrite: true`, and then the card says "replaces <path>".
- **Undo.** `beforeWrite(abs)` runs before the bytes are written, so the reply's checkpoint and Undo cover the new file. One `writeFile(abs, buffer)` writes it.
- **Rules.**
  - Add the three names to `EDIT_TOOLS` in `src/server/permissionRules.js`, so the person's edit rules (deny, ask, allow) judge `path` exactly as for `write_file`.
  - Every image `path` is judged by the person's **read** rules, the same way as `read_file`, and read through the workspace read path.
  - If any path is denied, nothing is written.
- **Modes.** Plan mode refuses the tools, as it does every `'edit'` tool. Manual mode asks. Auto mode runs them unless a rule says ask.
- **The card.** Its detail is an outline, not the JSON:
  - Word: the headings and the block counts;
  - Excel: the sheet names with their row and column counts, and every formula listed;
  - PowerPoint: the slide titles.
  - `cardTooLong` applies to the outline.
- **Engine chats** (Claude Code, Codex) don't get these tools: the floor refuses `mcp__bunny__*`. An engine can make Office files with its own commands. That is the engine's write path, and is outside this spec.

### Chat mode (no folder)

- The tools are offered in a Bunny-model chat. They are not offered in the Quick ask bar (text only) or in incognito, which has no tools.
- **Risk is `'own'`.** The file goes only into Bunny's data folder, at `<dataDir>/made/<chatId>/<uuid>.<ext>`. The model picks a name, and only the name: `path` is cleaned with `safeName()` from `attachments.js` and never used as a path.
- **The person gets a file card in the chat:** the name, the kind, the size, and the buttons Open, Save as… and Show in folder.
  - Save as… is Electron's save dialog, so the person chooses where the file goes. The model never writes outside the data folder in Chat mode.
  - The card is kept with the message, the same way as `artifact` in `sessions.js`, so it shows again on reload.
- **The route** is `GET /api/sessions/:id/made/:fileId`.
  - Both ids are uuid-checked, and the file is looked up only under that chat's own folder.
  - It is served with `content-disposition: attachment`, `x-content-type-options: nosniff` and `cross-origin-resource-policy: same-origin`, the headers of `/api/screens/` plus attachment.
  - An Office file is never displayed inside Bunny's page.
- **Deleting the chat** deletes `<dataDir>/made/<chatId>/`.
- **A file attached to the chat** is read with the existing attachment path. The model makes a **new** file; the attachment is never changed.

## 5. Limits

| What | Limit | Why |
|---|---|---|
| Tool arguments | 4 MB of JSON | Bigger is refused before parsing. |
| Text in one file | 2,000,000 characters | Beyond that the card and the worker get slow. |
| Excel cells | 200,000 per file; a cell's text at most 32,767 characters | 32,767 is Excel's own limit. |
| Images | Code mode only; at most 20 per file, each at most 10 MB; PNG or JPEG by their first bytes (not the name) | Chat mode has no folder to read from. |
| The finished file | At most 50 MB | The same limit as `download_file`. A bigger result is refused and nothing is written. |
| Build time | 30 s, then the worker is terminated | |

Every refusal says which limit was hit and that nothing was written.

## 6. Tests

### Unit (`test/office-make.test.js`, using invented content only)

1. Each tool makes a file that `readDocument` reads back, with the headings, cells and slide titles as sent.
2. Inline marks: `**b**` makes a bold run, a `javascript:` link is written as plain text, and an `https:` link becomes a link.
3. Excel cells:
   - `"=1+1"` as a string comes back as the text `=1+1`;
   - `{formula:"SUM(A1:A2)"}` is kept;
   - every name on the refused list, a `[book.xlsx]` reference and a `cmd|` form are refused.
4. Path checks:
   - `..\x.docx`, an absolute path, `.git\x.docx`, a link that leads out, a wrong extension and `x.docx.exe` are refused;
   - an existing file without `overwrite` is refused, and with it is replaced.
5. Rules:
   - an edit deny rule on `docs/**` refuses `make_word` at `docs/a.docx`;
   - an ask rule asks in Auto mode;
   - a read deny rule on an image path refuses the call;
   - in every refused case nothing is written.
6. Undo: after `make_excel`, the reply's checkpoint holds the file as not existing, and restoring it removes the file.
7. Limits: 200,001 cells, 51 sheets and a 51 MB result are each refused with the limit named. The 30 s worker limit is tested with a stub worker that never answers.
8. Plan mode refuses all three. Chat mode writes only under `<dataTemp>/made/<chatId>/`, and a `path` of `..\..\x.docx` becomes a plain name there.
9. Chat deletion removes `made/<chatId>/`.

### End-to-end (with `BUNNY_FAKE_UPSTREAM`, an invented profile)

- **Code chat:**
  - the stand-in model calls `make_word`;
  - the card shows the outline;
  - Allow writes the file;
  - the Changes pane lists it;
  - Undo removes it.
- **Chat mode:**
  - the stand-in model calls `make_powerpoint`;
  - the file card appears with Open, Save as… and Show in folder;
  - on reload the card is still there.
- **Pictures:** desktop and phone, both themes.

### Gate

- `npm audit` is still 0 with the override.
- The installer-size note is in the PR.

## 7. Help (O7)

- A help section "Make Word, Excel and PowerPoint files", with one invented-profile picture of the card and one of the file card.
- The README line is checked by Librarian.

## 8. Out of scope (later)

- Editing an existing Office file in place. That is a different tool, which reads the file and writes a new one.
- Charts in Excel or PowerPoint.
- Templates from the person's own files.
- Images in Chat mode.
