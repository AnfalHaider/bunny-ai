# QA: every Settings control at e2ec6ec6 (claude/v0115-integration)

Invented profiles only (BUNNY_FAKE_UPSTREAM=1), real Electron for the pages, a scripted model for what a setting does to a chat. Report only; nothing fixed. For Design.
Scripts: `e2e/w0115-sinventory.mjs` (all 105 controls found), `w0115-sapply.mjs` (change each through the page, restart, read again), `w0115-sbehave.mjs` (what the model is sent with the setting each way), `w0115-sui.mjs` (appearance effects, controls the first pass missed, rules, aliases, display sections, language).

Columns. Works: **Y** = I saw the behaviour change (request, DOM or saved data differed); **Y\*** = saved and a consumer exists in the code, but I did not exercise the behaviour; **N** = nothing happens; **?** = not tested. Sticks: survived a full app restart (Y/N). Clear: label and help line say what it does (Y / partly / N).

## 1. Dead, broken or unclear first
| Section | Setting | Works? | Sticks? | Clear? | Notes |
|---|---|---|---|---|---|
| Language | Language (English, Español, Français, العربية) | partly | Y | partly | Main window: about a third of its words change (e.g. "All chats" stays English). The whole Settings window stays English. The help says "The interface language", which promises more than it does. Replies are not affected (no language text reaches the model). Four languages offered, none complete. |
| Models | Aliases | Y, but silent failure | Y | partly | A line without " = " (e.g. `qa-aliases`) is dropped with no message and nothing saved. Help line shows the format but the page never says a line was ignored. The control's accessible name is "Model aliases" but its label is "Aliases". |
| Models | Allowed models | Y | Y | partly | Works (model list filtered), but one id per line with no check that the id exists: a typo hides every model, and the list went empty in my test because the built-in offline models are filtered out too. No warning that empty-result is possible. |
| Models | Wait for a first reply | Y | Y | partly | Help says "Used only when Try another model is on", yet it stays editable when that is off (I did not see it dimmed). The Custom field has no unit or range. |
| Capabilities | Quick ask searches by itself | Y | Y | partly | Belongs with Quick ask (Desktop app), not under Search this PC in Capabilities. Dimmed until Search this PC is on, with no line saying why. See the Quick ask audit for what it does and does not do. |
| Capabilities | Search this PC > After a search | Y | Y | partly | Help is a 90-word paragraph with character counts (20,000 / 14,600); the choice itself is two options. |
| Desktop app | Quick ask shortcut (Change) | Y | Y | Y | Accepts Ctrl+C (and other copy/paste keys) with no warning. |
| Desktop app | Allow other devices to open Bunny | Y (0.1.14 walk) | Y* | partly | The same switch name appears twice (once under "Use Bunny in a browser", once in a "Device access" group where it is a disabled, hidden duplicate). |
| Profile | Sign-in apps (advanced) / Google | Y* | Y* | N | The Google button is greyed and says "Needs a Google client ID under Sign-in apps first"; the fix is registering your own OAuth app in a cloud console. Plain-language path for a normal person: none. |
| Code | Default effort | Y | Y | partly | Follows the "Permission rules" block with no heading of its own, though it is about how hard the model thinks, and applies in Chat too. |
| Code | Branch prefix, Keep going on long jobs, Longest long job, Helpers, Prompt suggestions, Summary and next steps, When you ask for an unrelated task | Y / Y* | Y | Y | All follow the "Permission rules" block in the same group, with no heading of their own, so they read as part of it. Prompt suggestions, Helpers and Summary are not Code-only; "Code" is also the name of a group in Appearance and of this section, and "Code theme and font" here is only a button that opens Appearance. |
| Capabilities | Speech voice | Y* | Y | partly | Says "the Windows voice used for the Speech job"; I could not tell from the page what "the Speech job" is or where to start it. Effect on audio not exercised. |
| Appearance | Transcript text size, Transcript width, Code colours (light/dark), Code font size | Y | Y | N | No help line at all. The first two change the page (16px / 1080px set on the main window); code colours not seen drawn. |
| Bunny | Instructions for every chat | Y | Y | N | No help line (only a character count). It reaches the model's system text (seen). Saved by typing, with a brief "Saved" cue. |
| Code | Permission rules form (folder, what the rule matches, pattern, what happens) | Y | Y | partly | Rule added, listed, applied; the four form fields have no help of their own, and the try-it box answer is buried among long help paragraphs below it. |
| Privacy | Storage (Sessions / Secrets / Server) | n/a (display) | n/a | partly | "one JSON file per chat", "Windows DPAPI, per user" and a local address: jargon, and no controls. A "Privacy" section with nothing to set. |
| Connection | Provider / Model / Test mode | n/a (display) | n/a | partly | Display only; duplicates the Models picker. "Test mode: on" is shown only in test builds. No way to change anything here. |
| Usage | (nothing used yet) | n/a | n/a | Y | Display only. Not exercised with real usage numbers. |

## 2. Everything else (works as expected)
| Section | Setting | Works? | Sticks? | Clear? | Notes |
|---|---|---|---|---|---|
| Profile | Profile photo | ? | ? | Y | Not exercised (file dialog). |
| Profile | Full name | Y* | Y | Y | Saved; shown in sidebar. |
| Profile | What should Bunny call you? | Y | Y | Y | Goes into the model's system text (seen: name swapped). |
| Profile | GitHub sign-in | ? | ? | Y | Not exercised (needs real sign-in). |
| Appearance | Theme | Y | Y | Y | Main window switched to dark. |
| Appearance | Interface font | Y | Y | Y | Main window font variable changed. |
| Appearance | Response font | Y | Y | Y | Reply font variable changed. |
| Appearance | Label chats by status | Y* | Y | Y | Consumer in chat.js; sidebar not inspected. |
| Appearance | Default transcript view | Y* | Y | Y | Consumer in chat.js; not exercised. |
| Appearance | Motion | Y | Y | Y | data-motion set on the page. |
| Appearance | Code font | Y | Y | Y | `--font-mono` set; was missed by the first pass because the row has no id. |
| Notifications | Reply ready | Y* | Y | Y | Saved; the real notification was not exercised. A section holding one switch. |
| Bunny | Use memory | Y | Y | Y | Memory tool no longer offered when off. |
| Bunny | Search and reference chats | Y | Y | Y | search_chats tool no longer offered when off. |
| Bunny | Generate memory from chats | Y | Y | Y | With it on, 2 memories saved from one message; none when off. |
| Bunny | Include sensitive topics in memory | Y | Y | Y | The "do not save sensitive details" sentence leaves the model's text when on. |
| Bunny | Your memory / Import memory | ? | ? | Y | Buttons, not exercised here. |
| Capabilities | Artifacts | Y | Y | Y | Artifact tools and instruction removed when off. |
| Capabilities | Draw charts in artifacts | Y* | Y | Y | Page-side drawing; no effect on the model's request (as expected). |
| Capabilities | Use skills | Y | Y | Y | With one skill on, its text leaves the system text when off; with none installed nothing differs. |
| Capabilities | Use connectors | Y* | Y | Y | Consumer in app.js; no connector installed, so no visible change. |
| Capabilities | Enable computer use / Let the AI control the desktop | Y* | Y | Y | Saved (`computerUseEnabled`, `aiComputerUse`); the second only shows when the first is on. Acting on the desktop not exercised. |
| Capabilities | Search this PC (confirm dialog) | Y | Y | Y | Dialog names the model that gets file text. |
| Capabilities | Excluded folders | Y | Y | Y | Applied (3 results to 1). |
| Capabilities | Let the AI build its own tools | Y* | Y | Y | Saved (`customToolsEnabled`); building not exercised. |
| Models | Show models | Y* | Y | Y | Saved; picker not exercised. |
| Models | Longest reply | Y | Y | Y | Token limit in the request moved 4,000 to 12,000 when 1,000 to 3,000 was set (the sent number is a multiple of the setting; the page says only "the most tokens a single reply may use"). |
| Models | Token budget for one reply | Y* | Y | Y | Consumer in caps.js; ask-to-continue not exercised. |
| Models | Try another model when yours is busy | Y* | Y | Y | Saved as `fallbackWhenBusy`; consumed only in the page code (api.js, chat.js), not by the server. Fallback itself not exercised. |
| Code | Default permission mode | Y* | Y | Y | Consumer in app.js (applies to a chat with no mode of its own). |
| Code | Keep going on long jobs / Longest long job | Y* | Y | Y | Consumer in caps.js; not exercised. |
| Code | Helpers (dynamic workflows) | Y | Y | Y | The helper tools and their instruction leave the request when off. |
| Code | Summary and next steps | Y | Y | Y | The "finish with a report" sentence differs. |
| Code | When you ask for an unrelated task | Y | Y | partly | "Do it here" removes the move-to-new-chat tool; "Ask" and "Start a new chat" differ only in which button is pre-picked. Help does not say that. |
| Code | Prompt suggestions | Y* | Y | Y | Consumer in chat.js. |
| Code | Branch prefix | Y* | Y | Y | Used when creating a branch/worktree; not in the chat request. |
| Engines | Engine for new chats | ? | ? | Y | Only "Bunny" is offered until an engine is downloaded (single option, no explanation why others are missing). |
| Engines | Use Bunny's engine | Y (0.1.14) | Y | Y | Needs an engine downloaded to show; confirm dialog works. |
| Desktop app | Quick ask on/off and shortcut | Y | Y | Y | See the Quick ask audit. |
| Desktop app | Start when I sign in | Y* | Y | Y | Saved; the Windows login item was stubbed. |
| Desktop app | Keep running in the tray | Y | Y | Y | Turning it off turns Quick ask off, with a note. |
| Desktop app | Keep the same address after restart | Y* | Y | Y | Saved (`keepAddress`, `fixedPort` 59926). |
| Desktop app | Open in your browser / Install as an app | ? | ? | Y | Not exercised in this pass (earlier walk covered the browser view). |
| About | Update automatically | Y* | Y | Y | Saved (`autoUpdate`); consumer in main.js. |
| About | Check for updates / Licences | ? | ? | Y | Not exercised (real network). |

## 3. Facts behind the table
- All 105 controls were found; 53 were changed through the page and re-read after a restart: all kept their value. Display-only sections (Privacy, Connection, Usage) have no controls.
- No setting key is unused: every key has at least one consumer in the code. Two exceptions are worth a look: `uiZoom` is accepted by the server but has no Settings control (set by the View zoom); and `fallbackWhenBusy` is read only by the page.
- Saved by typing, no Save button: Instructions (with a brief "Saved" cue), Full name, call name, Branch prefix. Saved by a button: the Models section (Save models). A mix a person cannot tell apart.
- Section oddities for Design: single-control sections (Language, Notifications); "Code" used as a name in three places; Quick ask split between Desktop app and Capabilities; seven unrelated Code and chat settings follow the "Permission rules" block with no heading of their own.

## 4. Not covered
Profile photo, real GitHub or Google sign-in, real notifications and login item, Windows speech output, real connector and skill use, real engine download and sign-in, fallback model switching, the memory manager and import, update checks, remote-device access (covered in the 0.1.14 walk), phone-width Settings (covered in the 0.1.14 walk, not re-done here).
