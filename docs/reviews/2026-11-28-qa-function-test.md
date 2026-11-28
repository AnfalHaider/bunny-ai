# QA functional test of Bunny AI v0.1.16 (main @ bb229a0f)

**Date:** 2026-11-28 · **By:** QA · **Asked by:** Chief of Staff, for the owner ("test whether all features work the way they are supposed to, what can be simplified and what can be improved, parity with Claude app, and Bunny powerful enough to work on its own and smart").
**Code under test:** `bb229a0f`. Its code is identical to `97e3eb29`, the release sha that passed the gate (232 unit, 700 end-to-end, 0 failed) and that QA signed.

## Verdict in one paragraph

Everything I could drive without a real model works: 71 rows work, 0 are broken, 6 are unclear (4 of those are my own example inputs that the app refused with a clear message, 1 is a confusing label, 1 is a limit of fake mode). No feature I touched crashed, lost data, or threw a console error that was not fake-mode noise. What I could **not** test is the part the owner cares about most, "powerful enough to work on its own and smart": fake mode answers every message with a canned echo, so it cannot show tool choice, multi-step work, recovery from a failed step, Smart/Auto judgement, artifacts or office files being made. Those wait for a real model (section 6). The strongest findings are about **simplification and parity** (section 4), not defects.

## 1. How this was run

- **Profile:** invented only. `BUNNY_DATA_DIR` = a temp folder, `BUNNY_FAKE_UPSTREAM=1`, a fixed test token. Never `%LOCALAPPDATA%\BunnyAI`. Git folders and files used for the Code chat were invented too.
- **Browser:** Chromium through Playwright at 1280×860 (and 390 px for the chat page). **Real window:** Electron 45 through Playwright `_electron`, same invented profile, with the window's own bridge.
- **Scripts** (in `e2e/` on QA's worktree, not committed here; this doc lists their rows): `w0128-chat.mjs`, `w0128-app.mjs`, `w0128-tools.mjs`, `w0128-electron.mjs`. A re-run needs `BASE`, `TOKEN`, `OUT` and a running fake server (see each file's head).
- **Earlier QA runs that still apply to this sha** (same code): the O8 walk of 16 pages in both themes (`w0115-*`, `w0116-*`: places 46/46 and 16/18, Bunny local 34/34 and 5/5 in the window, web search 10/10, sign-in code 10/10, real-runner chat 9/9). Not repeated here.
- **Each row says:** steps → expected, actual, and a note on what fake mode cannot show. Pictures are in `docs/reviews/2026-11-28-qa-pictures/` (invented profile only, no real data).

## 2. Counts

| Result | Rows |
|---|---|
| works | 71 |
| unclear | 6 |
| broken | 0 |

## 3. What fake mode cannot show (these rows are API/UI-shape checks only)

The reply is always "This is a local test reply from <model>. **You said:** <your words>" plus a code block. So these were **not** run and are UNKNOWN:

- tool choice and multi-step agent work; recovery after a failed step; Smart/Auto risk judgement on real commands;
- whether a model receives attached file text or pictures (only that the chip and message card show);
- artifacts and office files being made by a model (the artifact and `office-make` specs pass in the gate);
- real downloads (GitHub, Hugging Face), a real local model, real Claude/Codex/GitHub/Google sign-in, connector OAuth, real web search results, Search this PC on the real Windows index, update download and install, notifications, open-at-login, speech, the real phone's address bar, the Quick ask bar and tray (the Settings rows exist; I did not press the shortcut), removable/network/OneDrive drives, and 390 px or the dark theme inside the real window (the window cannot go below 720×520).

## 4. Findings: confusing, too many steps, different from the Claude app

I did not run the Claude app side by side. "Claude app" below is my knowledge of how it behaves, so treat these as opinions to check, not facts.

| # | Where | What I saw | Suggestion |
|---|---|---|---|
| F1 | Chat composer | Four separate dropdowns around the box: model chip, job ("Auto · Chat"), permission ("Smart") and effort ("Medium"). Claude shows one model chip. | Keep the model chip; fold job into it ("Auto" is already the default) and tuck effort and permission behind one small settings button. |
| F2 | Permission names | The permission list says **Smart, Ask each time, Accept edits, Plan mode, Auto**; the mode menu says **Smart, Auto, Manual, Accept edits, Plan**: a different order and two names for "ask each time". | One set of names in one order everywhere. |
| F3 | First chat after connecting a provider | With the default "Show models" setting, a freshly connected provider's chat says "3 models are hidden by your 'Show models' setting" and refuses to send ("Choose a model first") until you press **Show all models**. Partly a fake-mode artefact (offline models are not on the popular list), but a real provider with only unlisted models would meet the same wall. | Pick the best visible model automatically; if none, offer the button inside the error. |
| F4 | Branch chip | A Code chat on a git folder with a commit shows **No branch**. It may only mean "Bunny made no branch yet", but it reads as a fault. | Show the current branch name, or "On main (no Bunny branch yet)". |
| F5 | Usage and data | Read-only page. It shows "28 messages · 0 chats" after chats were deleted. No export-all, no delete-all. | Add "Export my data" and "Delete all chats"; explain why chats can read 0 while messages remain. |
| F6 | Attachments | The message shows a file card (name and size) but nothing says whether the file's text was sent. | Show "Read note.txt" under the card once sent. |
| F7 | Projects | Instructions and memory notes work. I did not find "project files" (Claude Projects can hold files for every chat). | Check whether that is meant to be covered by the context list; if not, a gap. |
| F8 | Providers page in a browser, fake mode | Console 404 for `/api/local-models/places`. Harmless, noisy. | Skip the call when the service has no places support. |
| F9 | Change… in the real window (from the O8 run) | The Bunny local download-folder picker takes about 3 s with no busy sign (OBS-4). | Show "Opening…" at once. |
| F10 | Remove Bunny local (from the O8 run) | A download edited in place is deleted because the identity rule compares only the file (OBS-2). | Compare size and modified time too. |

F9 and F10 were reported to the Chief before the release and signed as not blocking.

## 5. Results by area

Each row says works / broken / unclear. Notes carry the limit of what was checked.

### Chat (browser, 1280×860)
| Row | Feature | Result | Steps → expected | Actual | Note |
|---|---|---|---|---|---|
| C0 | Fresh page: greeting, composer, suggestions | **works** | open / → a greeting, the composer, a few starter prompts | {"greeting":"Good afternoon, Sam.","sugg":0} |  |
| C1 | Model picker opens, filters, picks | **works** | click the model chip, type "large", pick the first → a grouped list; the search narrows; picking closes it and the chip shows the model | {"n":7,"n2":1,"chip":"Bunny Large (offline)"} |  |
| C2 | Enter sends, reply streams, chat kept after reload, auto-titled | **works** | type "hello bunny", press Enter, wait, reload → user and assistant messages, a title from the first message, same thread after reload | {"body":"This is a local test reply from offline/bunny-larg","title":"hello bunny","msgsAfterReload":2} |  |
| C3 | Code block in a reply has a copy button | **works** | look at the reply of C2 → highlighted code with a Copy button | {"pre":1,"copyButtons":1} |  |
| C4 | Message action bar: assistant and user | **works** | hover a reply and a question → copy, retry, branch on the reply; copy, edit on the question | {"acts":["copy","retry","artifact","read","branch"],"uacts":["copy","edit","branch"]} |  |
| C5 | Retry asks again and keeps one answer | **works** | click Retry on the reply → still one answer | {"before":1,"after":1} |  |
| C6 | Edit a message replaces it and asks again | **works** | click Edit on the question, change the text, Enter → the question reads "second wording" and the reply echoes it | {"hasNew":true,"hasOld":false,"msgs":2} |  |
| C7 | Branch opens a nested chat that points at its parent | **works** | click Branch on the reply → a second chat appears with a parent link | {"before":4,"after":5,"parent":true} |  |
| C8a | Typing / shows the command list | **works** | type / → a menu with /clear, /compact, /export and more | /compact Summarise this chat to free context /clear Start a new chat, keeping this one /export Download this chat as Markdown /new Start a new chat /remember Remember something (for this project or ev |  |
| C8b | /compact keeps the conversation and adds a labelled summary | **works** | type /compact, Enter → a summary row; earlier messages still on screen | second wording Copy Edit Branch This is a local test reply from offline/bunny-large. You said: second wording js Copy console.log("hello from the test reply"); Copy Retry Save as artifact Read aloud B |  |
| C8c | /clear starts a new chat and keeps the old one | **works** | type /clear, Enter → empty thread, old chats still listed | {"msgs":0,"chats":5} |  |
| C9a | Attach a text file: chip shows, message carries it | **works** | attach note.txt, ask a question → a chip with the file name before sending; the message shows the file; the model sees its text | {"chip":"note.txt ×","sawText":false,"sawName":true} | The file name chip and message card work. Whether the model receives the file text cannot be seen with fake mode (it echoes only the typed words). |
| C9b | Attach a picture | **works** | attach dot.png, send → a thumbnail before sending and in the message | {"pending":1,"imgInMsg":1} |  |
| C10 | Stop ends the stream and gives the composer back | **works** | send a long-answer prompt, press Stop → the Stop button goes away; Send returns | {"stopVisible":false,"sendVisible":true} |  |
| C11a | Search finds a chat by title and shows nothing for a miss | **works** | type in Search chats → one hit for the title; empty for nonsense | {"found":true,"none":"No chats match."} |  |
| C11b | Search matches message text, not only titles | **works** | GET /api/search?q=<word from a message> → the chat is found | [{"id":"40ad7eb3-9d43-420b-b57b-81420b015587","title":"Renamed by QA","providerId":"anthropic","model":"offline/bunny-la | API only |
| C11c | Delete a chat | **works** | DELETE the chat → 200 and gone from the list | {"status":200,"left":false} | API only |
| C12 | Incognito chat leaves nothing in the list | **works** | click Incognito, send a message → a visible incognito marker; the chat is not saved after leaving | {"chatsBefore":5,"chatsAfter":5,"mark":""} | saved list checked while still open |
| C13 | Export a transcript | **works** | GET export → a markdown transcript | # hello bunny (branch)  _Exported 2026-11-28T12:33:04.942Z_  ## You  second wording  ## Assistant  T | API; the Export button was not clicked |
| C14 | Ask / Auto / Smart, permission mode, effort, job kind | **works** | open each control → Ask, Auto and Smart explained; permission and effort choices; job kinds | {"modes":"Mode Smart Runs on its own in a git folder you trusted, with a check on each risky action; asks elsewhere ✓ 1 Auto Runs what you allowed without asking; sending an email still asks 2 Manual Always ask before ma |  |
| C15 | Chat at 390 px: no sideways scroll | **works** | resize to 390 → scrollWidth <= 390 | 390 |  |
| CE | Console errors across the chat flows | **works** | collect → none | [] |  |

### Pages, projects, memory, schedules, Code chat, devices, updates (browser)
| Row | Feature | Result | Steps → expected | Actual | Note |
|---|---|---|---|---|---|
| S-profile | Settings › profile opens with its rows | **works** | open settings.html?section=profile → a titled section with working rows, no error | {"chars":1303,"controls":7,"head":"Profile Profile photo PNG, JPEG or WebP, up to 10 MB. Shown in the sidebar; it stays on th","newErrors":0} |  |
| S-appearance | Settings › appearance opens with its rows | **works** | open settings.html?section=appearance → a titled section with working rows, no error | {"chars":1784,"controls":13,"head":"Appearance Theme Follow the system, or force light or dark. System Light Dark Interface fo","newErrors":0} |  |
| S-models | Settings › models opens with its rows | **works** | open settings.html?section=models → a titled section with working rows, no error | {"chars":1852,"controls":8,"head":"Models EFFORT Default effort How hard the model thinks in a new chat. Low Medium High Max ","newErrors":0} |  |
| S-bunny | Settings › bunny opens with its rows | **works** | open settings.html?section=bunny → a titled section with working rows, no error | {"chars":864,"controls":7,"head":"Instructions Sent to the model at the start of every chat: how you like answers, what you ","newErrors":0} |  |
| S-capabilities | Settings › capabilities opens with its rows | **works** | open settings.html?section=capabilities → a titled section with working rows, no error | {"chars":3158,"controls":14,"head":"Capabilities Artifacts Keep replies as artifacts and open them in their own panel next to ","newErrors":0} |  |
| S-code | Settings › code opens with its rows | **works** | open settings.html?section=code → a titled section with working rows, no error | {"chars":1177,"controls":8,"head":"Code chats BRANCHES Branch prefix Added to the start of every git branch name Bunny create","newErrors":0} |  |
| S-permissions | Settings › permissions opens with its rows | **works** | open settings.html?section=permissions → a titled section with working rows, no error | {"chars":5437,"controls":14,"head":"Permissions Default permission mode How careful a new chat starts out. You can change it p","newErrors":0} |  |
| S-quickask | Settings › quickask opens with its rows | **works** | open settings.html?section=quickask → a titled section with working rows, no error | {"chars":452,"controls":1,"head":"Quick ask Quick ask Quick ask is a small bar of Bunny's desktop app. Its on/off switch and","newErrors":0} |  |
| S-desktop | Settings › desktop opens with its rows | **works** | open settings.html?section=desktop → a titled section with working rows, no error | {"chars":279,"controls":1,"head":"Desktop app Use Bunny in a browser Install as an app This browser does not offer to instal","newErrors":0} |  |
| S-engines | Settings › engines opens with its rows | **works** | open settings.html?section=engines → a titled section with working rows, no error | {"chars":474,"controls":4,"head":"Engines B Bunny Built in · Default · always there CC Claude Code Not installed · 380 MB Do","newErrors":0} |  |
| S-usage | Settings › usage opens with its rows | **works** | open settings.html?section=usage → a titled section with working rows, no error | {"chars":200,"controls":0,"head":"Usage and data anthropic 28 messages · about 588 tokens · 0 chats Total about 588 tokens W","newErrors":0} | Read-only page by design: no controls, nothing to click; see suggestions. |
| S-about | Settings › about opens with its rows | **works** | open settings.html?section=about → a titled section with working rows, no error | {"chars":633,"controls":2,"head":"About Installed version This app runs on your own machine. 0.1.16 Update automatically Bun","newErrors":0} |  |
| P-providers | Providers page opens | **works** | open /src/ui/providers.html → content, no console error | {"chars":2507,"controls":48,"head":"Providers Connect and manage model providers Connected providers A Anthropic key unverified Direct access to Anthropic m"} | Opens with 48 controls. The only console noise is a 404 for /api/local-models/places, which fake mode does not serve (the places routes exist only with the real Bunny local service). |
| P-automation | Automation page (schedules, helpers, connectors) opens | **works** | open /src/ui/automation.html → content, no console error | {"chars":944,"controls":21,"head":"Automation Memory, tools, schedules, hooks and skills. Everything here is stored on this machine. Memory What Bunny know"} |  |
| P-customize | Customize page (skills, plugins, tools) opens | **works** | open /src/ui/customize.html → content, no console error | {"chars":1135,"controls":9,"head":"Customize Connectors, skills and plugins the model can use in your chats A connector the AI finds is added only at a pub"} |  |
| PR1 | Project: create with instructions, chat in it, sidebar filter | **works** | POST project, POST chat with projectId, pick filter → filter lists the project; only its chats show | {"opts":["All chats","QA project","QA project"],"list":"QA project 1 ＋ In project ⋯","projectStatus":200} |  |
| PR2 | Project memory: add and list | **works** | POST /api/projects/:id/memory then GET → the note is listed | {"items":[{"id":"3f3d7675-8b98-42b3-a647-291904b33424","text":"The user prefers metric units.","kind":"fact","source":"p | API only |
| PR3 | Project context applies to its chats | **works** | GET project-context → instructions and memory are reported for the chat | {"project":{"id":"d6ef7d6d-4823-4004-bf23-9adaa431bfbc","name":"QA project"},"enabled":true,"cut":[],"size":157,"parts":[{"n":1,"title":"Your instructions","siz | API only; whether the model obeys is a real-model check |
| M1 | Memory: add, list, delete | **works** | POST/GET/DELETE /api/memory → added, listed, deleted | {"add":200,"listed":1,"del":200} | API; the memory UI is on the Customize page |
| SC1 | Schedules: create and list | **works** | POST /api/schedules → created with next-run time | {"id":"4dd60c24-c621-4f18-80e9-c6d1564dfa9f","name":"QA daily","prompt":"say hi","everyMinutes":60,"providerId":"anthropic","model":"offline/bunny-large","permissionMode":"plan","folder":null,"enabled | API; actually firing at the time is not run (needs the app open at 9:00) |
| CD1 | Code chat: Changes and Files panes read the folder | **works** | create a code chat on an invented git folder with an edited file → Changes lists the edit; Files lists a.txt and b.md; a file opens | {"changes":"{\"checkpoints\":[],\"totals\":{\"files\":0,\"added\":0,\"removed\":0},\"more\":false,\"folder\":\"C:\\\\bunny-pictures\\\\tmp\\\\qa0128\\\\proj-PAx51K\",\"git\":false}","files":"{\"root\":\"proj-PAx51K\",\"p | API |
| CD2 | Code chat: folder, branch and engine chips; trust card | **unclear** | open the code chat → folder, branch and engine shown; a trust question for a folder not yet trusted | {"folder":"proj-PAx51K","branch":"No branch","engine":"Bunny"} trust=false | Branch chip says "No branch" for an invented git folder with a commit on its default branch. It may only show a branch Bunny made, but nothing on screen says so. |
| CD-Changes | Code chat Changes pane opens | **works** | click Changes tab → the pane opens with content or a clear empty state | {"had":1,"vis":true,"shown":"Changes ✕ ⟳ No changes yet."} |  |
| CD-Files | Code chat Files pane opens | **works** | click Files tab → the pane opens with content or a clear empty state | {"had":1,"vis":true,"shown":"Files ✕ proj-PAx51K a.txt b.md Open a file to read it."} |  |
| CD-Terminal | Code chat Terminal pane opens | **works** | click Terminal tab → the pane opens with content or a clear empty state | {"had":1,"vis":true,"shown":"Terminal ✕ ＋"} |  |
| CD-Browser | Code chat Browser pane opens | **works** | click Browser tab → the pane opens with content or a clear empty state | {"had":1,"vis":true,"shown":"Browser ✕ New tab × ＋ ← → ⟳ ⋯ Type a URL above, or open an HTML file from the ⋯ menu."} |  |
| CD-Tasks | Code chat Tasks pane opens | **works** | click Tasks tab → the pane opens with content or a clear empty state | {"had":1,"vis":true,"shown":"Tasks ✕ No tasks yet. When Bunny works through a job with several steps, its plan shows here."} |  |
| CD-rewind | Rewind with nothing to rewind says so plainly | **works** | POST rewind on a fresh chat → a clear refusal or a no-op, not a crash | 400 {"code":"rewind.invalid","message":"Say which point to go back to."} | API; the rewind with real edits is covered by e2e/rewind.spec.js and my earlier runs |
| CD-engine | Engines listed with account/sign-in state | **works** | GET /api/engines → Claude Code and Codex with download and sign-in state | {"engines":[{"id":"claude-code","label":"Claude Code","downloaded":false,"version":null,"available":"2.1.311","updateAvailable":false,"previous":null,"sizeBytes | download and real sign-in not run |
| DV1 | Phone/device access: passcode sign-in, wrong passcode refused, device listed | **works** | enable, sign in right and wrong → 200 for right, 401/403 for wrong, device listed | {"right":200,"wrong":401,"devices":1} | a real phone and its address bar are not run |
| U1 | Version and update check | **works** | GET version, POST update/check → the version; a check that answers (no feed in fake mode) | {"version":"0.1.16","updateUrl":""} / 200 {"current":"0.1.16","latest":"0.1.16","updateAvailable":false,"source":"https://api.github.com/repos | download and install of an update is not run (UNKNOWN) |
| PV1 | Add and remove a custom OpenAI-compatible provider | **works** | POST /api/providers/custom, DELETE → created then removed | 200 {"id":"custom-invented-endpoint","name":"Invented endpoint","tagline":"http://127.0.0.1:9/v1","kind" | API; real endpoint not reached |
| AE | Console errors across these pages | **works** | collect → none | ["404 /api/local-models/places","Failed to load resource: the server responded with a status of 404 (Not Found)","404 /api/local-models/places","Failed to load resource: the server responded with a status of 404 (Not Fou | Both 404s are /api/local-models/places in fake mode, nothing else. |

### Tools and accounts (HTTP API)
| Row | Feature | Result | Steps → expected | Actual | Note |
|---|---|---|---|---|---|
| T1 | Web search: Brave key save/clear (no key leaks back) | **works** | status shows key present, never the key | {"before":{"braveKey":false},"put":200,"after":{"braveKey":true},"leaks":false} | real search results not run (needs network) |
| T2 | Search this PC endpoints answer | **works** | activity and fixed-folder lists | 200 {"entries":[]} / 200 {"folders":["Bunny's own data folder and Electron's","AppData (every browser pro | real Windows index not run (needs the real machine) |
| T3 | Connectors: add an MCP server and list it | **works** | added, listed, removable | 200 {"id":"5ae0aaf2-091d-4474-91a9-bfd5c6aac7af","name":"Invented","url":"http://127.0.0.1:9/mcp","enabled":true,"folders":[ listed=1 | real OAuth sign-in and tool calls not run |
| T4 | Hooks: add and list | **unclear** | added and listed | 400 {"code":"hook.unknownEvent","message":"Unknown event: pre-tool"} listed=0 | My example body used an event name the route does not know; the route refused it with a clear message ("Unknown event"). Adding a real hook through the UI is covered by e2e/extras.spec.js. |
| T5 | Skills: add and list; plugin install route | **unclear** | a skill is saved; plugin install lists | 400 {"code":"skill.instructionsRequired","message":"A skill needs instructions"} listed=0 / plugins 404 | My example body had no instructions; the route refused it with a clear message. Skills UI is covered by e2e specs. |
| T6 | Permission rules: list and check a risky command | **unclear** | a verdict for a dangerous command (ask or deny) | 200 200 {"ok":false,"message":"Choose Command or Path (or Website, Tool or Helper)."} | My example body had no Command/Path; the route said what to choose. The rule check itself is covered by e2e/permission-rules.spec.js. |
| T7 | Abilities per model and custom tools list | **works** | abilities reported | 200 [{"id":"nvidia","name":"Nvidia","abilities":["coding","reasoning","long-context","tool-use"]},{"id":"opencode-go","name":"OpenCode Go","abilities":["coding","re / tools 200 |  |
| T8 | Make Word/Excel/PowerPoint/PDF from chat | **unclear** | a model tool; not callable without a model | covered by e2e/office-make.spec.js (in the gate: 700 passed); not driven here | needs a real model to choose the tool |
| T9 | Import a pasted chat | **unclear** | a chat appears | 400 {"code":"import.empty","message":"There is nothing to import"} | My pasted text was refused as empty; the Import dialog and file formats are covered by the e2e import specs. |
| T10 | Account page data (GitHub and Google sign-in state) | **works** | both shown as signed out | {"github":null,"google":null,"githubDeviceReady":false,"googleReady":false,"googleWorkspaceOn":false} | real device-code sign-in not run |
| T11 | Folder trust list | **works** | listed | 200 {"folders":[]} | the trust card UI is covered by e2e/folder-trust-f12.spec.js |
| T12 | Usage totals | **works** | per-provider totals | {"providers":[{"providerId":"anthropic","messages":28,"tokens":588,"sessions":0,"models":{"offline/bunny-code":6,"offline/bunny-large":8},"lastUsed":"2026-11-28 |  |
| T13 | Offline switch (test mode) | **works** | status shows offline then online | {"online":false} | chat while offline covered by e2e specs |

### The real Electron window
| Row | Feature | Result | Steps → expected | Actual | Note |
|---|---|---|---|---|---|
| E0 | The window opens on the app | **works** | chat page loads within a few seconds | {"url":"http://127.0.0.1:PORT","startMs":5000,"title":"Bunny AI"} |  |
| E1 | Desktop bridge present | **works** | secureWrite, pickFolder and more exposed to the page | platform,getPrefs,setPrefs,quit,openInBrowser,setRemoteEvent,pickFolder,secureWrite,browserAct,browserView,pcSearch,localModels,made,setTheme,zoom,quickAsk,updates |  |
| E2 | Chat in the real window | **works** | send and read a streamed reply | {"conn":200,"reply":"This is a local test reply from offline/bunny-code.\n\nYou sai"} |  |
| E-S-desktop | Settings › desktop in the real window | **works** | rows for the desktop features | Desktop app Start when I sign in Open Bunny AI when you sign in to Windows. off Keep running in the tray Closing the window keeps Bunny AI in the system tray, so schedules keep running. off Use Bunny in a browser Open in |  |
| E-S-quickask | Settings › quickask in the real window | **works** | rows for the desktop features | Quick ask Quick ask Press Ctrl+Alt+Space anywhere to ask Bunny in a small bar. It answers right there, as plain text. It uses no tools except reading the web (a search and reading a page) and, when Search this PC is on,  |  |
| E-S-about | Settings › about in the real window | **works** | rows for the desktop features | About Installed version This app runs on your own machine. 0.1.16 Update automatically Bunny AI checks GitHub Releases for a new version, downloads it in the background, checks it against its published fingerprint, and i |  |
| E-S-permissions | Settings › permissions in the real window | **works** | rows for the desktop features | Permissions Default permission mode How careful a new chat starts out. You can change it per chat under the message box. Smart (the recommended start) runs in Auto only in a git folder you trusted, with the second-model  |  |
| E3 | Main-process facts | **works** | one window, version 0.1.16 | {"windows":1,"version":"0.1.16","loginItem":false,"quickAskShortcut":false} | quick ask bar and tray not clicked (UNKNOWN) |
| E4 | Minimum window size | **works** | documented minimum | [720,520] |  |


### Where each area from the request is covered

| Area | Result | Where |
|---|---|---|
| Chat: streaming, stop, edit, retry, branch, copy, code block, slash, attachments, search, rename, delete, incognito, export | works | Chat table (C0–C15) |
| Modes Ask / Auto / Smart | menus and names work; **behaviour on a real risky command is UNKNOWN** | C14, F2; needs a real model |
| Projects and memory | works (filter, instructions, notes, context report) | PR1–PR3, M1 |
| Code chats: folder, Changes, Files, Terminal, Browser, Tasks panes | works | CD1, CD2, CD-* |
| Code chats: rewind, engine switch, trust card | rewind refuses cleanly with nothing to rewind; engines listed; **rewind with real edits and the trust card UI are covered by the gate's specs and my earlier runs, not repeated** | CD-rewind, CD-engine |
| Tools: web search key, Search this PC, connectors, hooks, skills | settings and routes work; **real results UNKNOWN** | Tools table |
| Office files, GitHub, installs | **unclear** (need a model or the internet) | T8, T10 |
| Schedules | create and list work; **firing at the set time not run** | SC1 |
| Devices and phone | passcode sign-in, wrong passcode refused (401), device listed; Activity list opened on 3 device rows at 3ab0e22d | DV1 |
| Sign-ins and providers | provider connect and custom provider work; Claude sign-in paste box 10/10 (earlier run) | PV1, earlier |
| Bunny local | 34/34, 5/5 in the window, places 46/46 (earlier run) | earlier |
| Settings, every row | all 12 sections open with no error (profile, appearance, models, bunny, capabilities, code, permissions, quickask, desktop, engines, usage, about). Changing every value was **not** done here; the settings specs in the gate cover that | S-* |
| Updates | version and check answer; **download and install UNKNOWN** | U1 |

## 6. Real-model checks (held until the Chief sends a model)

Proposed tasks, so the run is quick and comparable. Each gets a row (works / broken / unclear) with the transcript.

1. **Multi-step agent loop:** "In this folder, find the TODO comments, make a TODO.md grouped by file, and commit it." Expect list, read, write and commit without asking mid-way (Smart in a trusted git folder).
2. **Tool choice:** a question needing the web ("current Node LTS?"), one needing a file ("how many lines in a.txt?"), one needing neither. Expect the right tool or none.
3. **Recovery from a failed step:** a task whose first command fails (wrong path, missing package). Expect it to read the error and try another way, not stop or loop.
4. **Smart/Auto judgement:** a harmless edit and a risky one (delete a folder). Expect the first to run, the second to ask.
5. **Long run:** a 15-step task; check the step limit (500) and time limit (120 min), and that it does not ask permission to continue for no reason.
6. **Artifacts and office files:** "make a one-page HTML calculator" and "make a 3-slide deck". Expect the card, side panel and download.
7. **Memory and project instructions:** do project instructions change the answer; does `/remember` get used later.
8. **Ask-user:** an ambiguous task; expect one clear question, then carry on.

## 7. Evidence index

- Scripts: `e2e/w0128-chat.mjs`, `e2e/w0128-app.mjs`, `e2e/w0128-tools.mjs`, `e2e/w0128-electron.mjs` (QA worktree).
- Pictures (invented profile): `docs/reviews/2026-11-28-qa-pictures/`: `chat-reply.png`, `attach.png`, `modes-menu.png`, `code-panes.png`, `settings-permissions.png`, `window-chat.png`.
- Pointers for the findings: composer controls in `src/ui/index.html` (`#mode-button`, `#permission-mode`, `#effort-level`, `#job-button`); the two permission name lists are the `<select id="permission-mode">` options and the `#mode-menu` items.
