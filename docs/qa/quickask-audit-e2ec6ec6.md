# QA: Quick ask audit at e2ec6ec6 (claude/v0115-integration)

Invented profiles only (BUNNY_FAKE_UPSTREAM=1; a stand-in index of invented files; a stand-in internet; a scripted model). Report only, nothing fixed.
Scripts: `e2e/w0115-qaudit.mjs` (the bar's real answerer against Bunny's real server) and `e2e/w0115-qsettings.mjs` (real Electron, the page's own controls, restart on the same folders).

## Flows
| Flow | Expected | Actual | |
|---|---|---|---|
| A1 "find my tax returns file", Search this PC OFF, model calls tools | Plain words: Search this PC is off, turn it on in Settings | Model is offered only web_search/read_url and says "I do not have a way to look at your files here. Please open the full app." Bunny adds nothing about the setting | FAIL (dead end) |
| A2 same, model ignores tools | same | "I cannot see files... open the full Bunny app" | FAIL (dead end) |
| A3 Search this PC ON, model calls tools | Searches, finds both tax returns, names them | searching > 3 results > reading > read; answer names tax return 2025/2024 | PASS |
| A4 ON, model ignores tools (the owner's case) | Bunny searches itself and lists the files | No search is run; the model's "I cannot see files... open the full Bunny app" is shown | FAIL |
| A5 ON, model replies with the needs-window marker | A search or an answer | Card "This needs Bunny's window" (a question that says "files" counts as a local action) | FAIL |
| A6 "Quick ask searches by itself" OFF, plain question | No file tool; the bar points to the + menu | No file tool offered (correct), but the answer is "open the full app" with no hint about the + menu | FAIL (dead end; the switch itself works) |
| A7 same, Search this PC chosen in the + menu | File tool offered, files found | works | PASS |
| A8 After a search = Show what was found | List, files not read | searching > results(3), no reading | PASS |
| A9 After a search = Read the files | Reads best matches, names them | searching > results > reading > read | PASS |
| A10 Excluded folder (Documents) | Its files no longer found | results 3 -> 1 (only the Downloads file left) | PASS |
| B1 "weather in Islamabad today", model calls web_search | Searches, answers with source | 1 search, temperature and link | PASS |
| B2 follow-up "and tomorrow?" in the same bar | Stays in the bar, searches | 1 search, answered in the bar | PASS |
| B3 weather, model ignores tools | Bunny searches itself | No search; "I cannot browse the internet... Open the full app." shown | FAIL (the owner's complaint) |
| B4 follow-up after B3 | still searches | No search, same refusal | FAIL |
| B5 "search the internet for the weather in Islamabad", model ignores tools | Bunny searches and answers | Bunny's auto-retry ran 1 search (good); the scripted model then ignored the results and repeated its refusal. Bunny did its part | PASS for Bunny (model-dependent) |
| B6 same, model calls tools | one search, answer | works | PASS |
| B7 weather, marker reply | no dead-end card | Bunny ran a search, showed the model's words, no card | PASS |
| B8 "latest news about Pakistan cricket" (no "search the internet" words), model ignores tools | Bunny searches by itself | No search, refusal shown | FAIL |
| B9 small talk (control) | answer, no card | answer | PASS |

Why B3/B4/B8: the bar's own auto-search (lookupFirst) fires only when the words match "search/google/look up ... the internet/web" (askedToSearch in `electron/quick-ask-answer.js`). A plain question gets no help from Bunny if the model does not call web_search. Same shape for files (A4): with Search this PC on, nothing runs a file search unless the model calls it.

## Settings (real Electron; restart on the same folders)
| Setting | Expected | Actual | |
|---|---|---|---|
| Desktop app > Quick ask switch | On registers the keys and the bar opens; off releases them | as expected | PASS |
| Change shortcut to Ctrl+Shift+K | saved and registered | saved and registered | PASS |
| Change shortcut to Ctrl+C | refused with a note (it would take Copy away from every app) | Accepted and saved as the Quick ask keys, no note | FAIL (no blocklist for Ctrl+C/V/X/Z) |
| Tray rule ("keep running in the tray" off) | Quick ask turns off | turns off | PASS |
| Capabilities > Search this PC switch | confirm dialog, then on; sub-options usable | works; the dialog names the model that gets file text | PASS |
| After a search (read/show) | saved; changes the bar | saved; changes the bar (A8/A9) | PASS |
| Quick ask searches by itself | saved; changes the bar | saved; changes the bar (A6/A7) | PASS |
| Excluded folders (add) | saved, listed, applied | saved, listed, applied (A10) | PASS |
| Fresh bar after Search this PC turned on | + menu shows Search this PC; model line says "files on this PC" | yes | PASS |
| Bar clicked away from (hidden, kept 5 min), Search this PC then turned on, shortcut pressed | bar shows the new setting | The same page is shown again: + menu has no Search this PC, model line says "web search" only; stale until Esc or 5 minutes. (The server reads the setting per question, so a search would still work.) | FAIL |
| Restart: Quick ask on and keys; Search this PC on, After, auto, excluded folder | all kept | all kept; the keys are registered again at start-up with no click | PASS |

## "This needs Bunny's window" and dead ends
- A5 (files, marker reply): the window card.
- A1, A2, A4, A6, B3, B4, B8: not the card, but the model's own "open the full app" as the answer with no action offered; Bunny's own text never tells the person which switch or + menu item fixes it.
- No dead option among the switches and selectors: each saved, survived a restart and changed the bar. The Ctrl+C acceptance and the stale kept bar are the only setting defects.

## Not covered (UNKNOWN)
The real Windows Search index and real files (invented index only); a real model's choices (scripted only); the + menu Screenshot and Add a file items; the model picker (the bar names the chat's selected model; changing it was not exercised); OS-level shortcut conflicts (stubbed).
