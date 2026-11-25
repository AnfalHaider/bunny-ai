# v0.1.15 spec cross-check at 260cb5de (Tech Lead, read only)

2026-11-25. I read the code at `origin/claude/v0115-integration` 260cb5de through `git archive`. Nothing was run: no tests, npm or Electron.

- Two read-only helpers checked Quick ask, sign-in, Settings, Office and F1–F7.
- I checked every gap they reported, and every HIGH item myself.
- **Not checked against a written text:** Security's FG-1/FG-2 and IA-10/IA-11 aren't on any origin branch, so they were judged against what the code says they mean.

## Verdict: one blocker, so no sign-off yet

**B1: Quick ask says "Search this PC is off" on a default profile** (`electron/quick-ask-answer.js:186`).

- That line tests `settingsNow.pcSearchEnabled !== true`.
- The F8 default the owner approved is "on where it was never written". `src/server/pcService.js:51` and `electron/quick-ask-logic.js:18` both test `!== false`.
- So on a profile where the switch was never written, when the model refuses a file question, the bar shows "Search this PC is off" instead of searching. That is the owner's own "tax returns" complaint.
- **Fix:** `=== false`, plus a test with the setting unset.

## Table

| Piece | Verdict | Evidence / gap |
|---|---|---|
| Quick ask fixes (QA-WEB, QA-PCOFF, QA-META) | Built, with **B1** | `electron/quick-ask-answer.js`; `app.js` ~4469-4490 (search results fenced as data). Low: the PC-off text is sent twice (as a delta and again on the card). QA-WEB retries only when the reply has refusal wording. |
| Claude sign-in (SIGNIN-OPEN) | Built; real-CLI check UNKNOWN | `engines/claude-code.js` `signInUrlFrom` (https on the three hosts only); `service.js` sets `BROWSER` to a do-nothing file; `electron/main.js` uses `shell.openExternal`. No record in the repo shows the real CLI honours `BROWSER` or handles a URL with `&`; the plan says that waits on the second download. |
| Office files (OFFICE-MAKE, OM-1..7) | Built | Exact pins and the `image-size` override (`package.json:76-83`); lazy import, worker and limits (`officeMake.js`, `officeWorker.js`); formula allowlist (OM-2); pictures as bytes (OM-3); links (OM-4); the `made/` route (OM-5); the deleted chat's folder removed (`app.js:2328`). Notes: Excel document properties rely on the library's defaults (OM-6); escaping relies on the test run (OM-7); in a Chat-mode chat in Plan mode, `make_*` is still offered (the spec is silent). |
| Engine rule lists (section C) | Built | `src/ui/engines.js`: Deny/Ask/Allow lists, an add line, locked floor rows. "Bunny's own tools" moved below the list, which is plan item B (my LOW). |
| F1 | Built | `app.js:3060-3095` and `:4246-4272`: tools are loaded into the same reply after the yes. |
| F2 | Built | `capabilityMap.js`, `app.js:3033-3040`. |
| F3 | Built (in effect) | Chat mode now extends 6 steps at a time up to the Settings cap (`app.js:4539`); the spec suggested 12 at a time. |
| F4 | Partly | GitHub token and header sign-ins are built. The **curated list is marked "PROPOSED … to be checked by Security"** (`curatedPlugins.js:9`), with no Security review recorded. npm and PyPI registry candidates aren't listed (`pluginImport.js:218-231`), though `add_connector` takes npm and PyPI. |
| F5 | Built, one deviation | `sign_in`, `connector_sign_in`, the too-long-plugin card, the device line, HELPER_NEVER. `browser_panel` gives fixed text and no card (`app.js:3267-3272`). Harmless: the window always offers the browser tools, and elsewhere the model gets the fixed sentence. Google with no client gives words only. |
| F6 | Built, one deviation | Brave (key in DPAPI, header, `redirect: 'error'`), then DuckDuckGo, with "via". The browser-panel fallback is a hint only (`webSearch.js:89`). |
| F7 | Built, with deviations | `deferTools.js`. The threshold counts only the tools that can be deferred (`:14`, `:52-54`); helpers are never deferred (`app.js:3431`); skills aren't deferrable. A tool that wasn't loaded is refused (`app.js:4009-4012`). |
| F8 | Built | `app.js:3275-3282`: window-only card, finding only (`pcSearchAfter` untouched). |
| F9 | Built | `allowKinds.js`: fixed pairs, exact-command kinds, the reasons shown when no kind is offered, computer kinds for this reply only, `NEVER_KIND` (`app.js:3580`). |
| F10 | Built | `app.js:4160-4212`: one card in every mode, IA-7's off-first order, IA-0 checked before the card, no install in scheduled runs. |
| F11 | Built, one gap | `autoJudge.js`: typed turns only, the call fenced, strict JSON, a cut argument never allowed, the fall-backs, broad allow rules dropped (`app.js:2743`), the same provider by default. **G2:** every in-folder edit skips the judge, run-later files included (`app.js:4219`, `goesToJudge`; the test asserts it at `auto-judge-f11.test.js:110-113`). The spec said `package.json`, workflow and `*.ps1` edits go to the judge. Not a regression (v0.1.14's Auto wrote them unasked too), and the UI claims nothing about them. Security's call. |
| F12 | Built | `folderTrust.js` `smartMode`; with the judge down it acts as Ask (`app.js:2683`, `smartDown`). |
| F13 (option A) | Built | `confine.js`: label refusals (F13-1); the helper's sha256 checked before each use (F13-2); Low SID; `NOT_COVERED` (F13-4). There is never a silent unconfined run (`workspace.js:646-648`, `app.js:3164`). Option B isn't shipped, which is correct. |
| PG-1 | Built | `pgRules.js` `checkDomain` and `panelAllows`; `onBeforeRequest` in both panel sessions (`electron/browserViews.js:112`, `:283`). |
| PG-2 | Built | `toolKey` = connector id + original tool name. |
| PG-3 | Built | `allowSkipsCard` returns false for `message_session`. |
| PG-5 | Built | The `GIT_FIXED` options; `--no-ext-diff --no-textconv` on `diff` and `log -p`; flag allowlists; path arguments judged as reads (`app.js:4134`). Low: a clean filter in the repository's own `.git/config` isn't disabled. It wasn't on PG5-a's list. |
| PG-4 | Not shipped (correct) | — |
| SETTINGS-OVERHAUL | Built | The Language picker is removed and `language` forced to `en`; translation files are kept. The Google note and "How to connect" are there (`settings.html` ~85-94, ~1136-1149). |
| ENGINE-SWITCH | Built | Window-only; 409 while busy; needs Code mode and a folder (`app.js:2263-2296`). ES-1: `holdsPcText` (`engines/handover.js:44-52`). ES-2: a PATCH has the restricted fields stripped (`app.js:2313-2314`). |
| ONE-INSTRUCTIONS | Built | `project_doc_max_bytes = 0` (`engines/codex.js:67`). The canaries passed for both engines on 2026-11-24 (`engines/pins.json`). |
| FOLDER-RULES (frozen, FG-1/FG-2) | Built | The frozen copy comes from the trust record, never re-read from disk (`app.js:424-453`). FG-2: the card's shas are required (`app.js:2211`). |
| REWIND | Built | RW-1: a Chats device's POST is refused (not on WRITE, `remoteAccess.js:177-188`), the preview stays readable, and a device rewind is logged with a count. RW-2: each path re-checked before its write, `wx` then rename, only files deleted, folders made level by level (`rewind.js:109-180`). RW-3: `include` filtered against the changed list. Limits of 100 per chat and 1 GB (`checkpoints.js:17-18`). Undo now asks when a file changed. |
| PROJECT-CONTEXT | Built | Memory capped at 1,000 characters, with suggestions at 400 (stricter, labelled PC-6a); `looksSecret` refused (`projects.js:17-130`). The recent-work note uses `holdsPcFileText`, `holdsPcText` and `looksSecret` (`projectContext.js:38-43`). |
| INSTALL-ANYWHERE (IA-0..12) | Built where checked | **IA-0:** `publicFetch` at every call, with DNS resolved again, no redirect, and the test-only switches off in a packaged build. **IA-1:** git isolation (`gitSource.js:46-52`). **IA-2:** npm locked at card time, then `npm ci` (`npmSource.js:113-127`). **IA-3:** binary-only pip with hashes and `--isolated`. **IA-4:** zip links, PAX, real byte counts, `.git`/`.hg`/`.svn` dropped, 8.3 and NFC clashes (`installSource.js` `tidy`). **IA-5:** tree hash. **IA-7, IA-8, IA-12:** absolute program paths. IA-6, IA-9, IA-10 and IA-11 weren't checked one by one. |

## Shipped outside the plan

- Quick ask shortcut validation, and the bar re-reading settings when it is shown again. Both are small and harmless.
- Nothing else. The README rewrite is plan item E.

## Follow-ups for Security (not v0.1.15 blockers)

1. **Writes through an existing link.** `workspace.inside(path, { mustExist: false })` checks only the nearest existing parent, so a write to an existing file that is itself a link follows the link out of the folder.
   - The same code is at 8889a54e, so it affects `write_file` and the new `make_*` too.
   - It is low on Windows: file links need developer mode, and git checks links out as text files by default.
   - Fix: `lstat` the target, and refuse a link.
2. G2 above (run-later edits skip the judge).
3. The curated connector list needs Security's review of each entry (`curatedPlugins.js:9`).
4. PG-5: the repository's own clean filters.
