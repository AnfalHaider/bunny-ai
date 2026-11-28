# Architecture review: autonomy, simplification, reliability (Tech Lead, 2026-11-28)

The owner's request, typed in the Chief of Staff's chat on 2026-11-28, asked for "parity with Claude app", with Bunny "powerful enough to work on its own and smart". This is my part of that request: how the agent works today, what stops it finishing a job on its own, what can be simpler, and which bugs keep coming back.

**How this was done:**
- It's a read-only review of `main` at bb229a0f.
- Nothing was run: no tests, no app.
- File and line references are at bb229a0f, and the counts come from `grep` and `git log` on that commit.
- Whether each feature works is QA's part, not this one.
- Where I couldn't tell from reading, the text says UNKNOWN.

## Summary: the five changes that would matter most

| # | Change | Where | Size | Risk |
|---|---|---|---|---|
| 1 | Retry a failed model round with backoff (rate limit, 5xx, stall, unreachable), instead of ending the whole job | `src/server/chat.js:129` | ~40 lines | MEDIUM |
| 2 | Size the context limit within a reply from the model's real window, in every mode. Today it's a fixed 240,000 characters in Code mode only, and nothing in Chat mode | `src/server/app.js:4651` | ~15 lines | LOW |
| 3 | Add a "check your work" nudge: a reply that edited files and ran no check afterwards is asked once to run the project's checks | `onReplyEnd`, `src/server/app.js:4681` | ~20 lines | LOW |
| 4 | Nudge on open tasks in Chat mode too. Today only a chat with a folder is told it still has open tasks | `src/server/app.js:4685` | 1 condition | LOW |
| 5 | Move the Auto model ranking and the window-only list into a shared module that the server and the pages both import. Scheduled runs and helpers then get a fallback model, and the copy that drifted (SC-f) goes away | `src/ui/model-abilities.js:66-130`, `src/ui/api.js:29` | a move, plus a test | HIGH for the window-only part (it's a security control) |

Changes 1 to 4 are small and independent, and together they address the most common reasons a long job stops.

---

## 1. Autonomy and smartness

### How the agent works today

**The loop**
- `streamChat` (`src/server/chat.js:58`) runs rounds: it streams the model's answer and runs any tool calls the model asks for. Calls run one after another. Only `run_subagent` calls run side by side (`chat.js:251`).
- When the rounds run out, `finalAnswer` (`chat.js:271-287`) asks for a closing report that ends with "send continue".

**Step budget**
- Effort sets the starting rounds (`app.js:4424-4431`): Chat mode 3, 6, 10 or 16, and Code mode 12, 30, 45 or 70.
- `extendRounds` (`app.js:4643-4651`) adds more rounds up to the caps in `caps.js`. The defaults are 500 steps and 120 minutes; a scheduled run gets 100 steps and 30 minutes.

**Limits that ask the person**
- The loop stops to ask on any of these (`chat.js:101-116`), and the person answers in a card (`app.js:4662-4679`):
  - the token budget is spent;
  - the same step ran 3 times in a row;
  - 25 rounds passed with no new step.
- A scheduled run has nobody to ask, so it stops (`app.js:4663`).

**Planning**
- **Task list:** the model keeps one with the `update_tasks` tool (`app.js:4122`), and the list is carried into the next reply (`app.js:2815`). The Code-mode prompt asks for a list on jobs of about ten steps or more (`app.js:2939`).
- **Progress file:** the prompt also asks for a progress file, `.bunny/progress.md` (`app.js:2934`). That's prompt text only: nothing checks that it exists.

**Nudges when the model stops early** (`onReplyEnd`, `app.js:4681-4705`)
- If the reply stops with open tasks and no question, it's told to carry on. This happens at most 3 times, and only in a chat with a folder that isn't in Plan mode (`app.js:4685`).

**Choosing tools**
- Every tool is offered, and `find_tools` loads the deferred ones (`deferTools.js`).
- A model that refuses tools is retried without them (PV-1, `chat.js:132-161`).

**Helpers** (`app.js:3495-3560`)
- A helper runs in a fresh conversation with its own chat.
- A helper can start helpers of its own, but those can't go deeper: three levels in all (`app.js:3501`).
- There are at most 12 helpers per reply and 4 at once (`app.js:3619-3620`).
- A helper's model is picked by its job (`app.js:3576-3617`). If the chosen model fails before doing anything, the helper falls back to the chat's model (`app.js:3548`).

**Checking its own work**
- There's prompt text only: "say what you changed and how you verified it" (`app.js:2931`), and the high and max effort notes (`app.js:4427-4428`).
- No step in the loop makes it check.

**Recovering from errors**
- **A tool error:** it goes back to the model as text (`chat.js:245`). That's good.
- **A provider error:** `streamRound` throws on any answer that isn't OK (`chat.js:399-404`), and there's no retry.
- **The attempt loop** (`app.js:4625`) retries only when nothing has happened yet:
  - when the account can't afford the reply, it asks for fewer tokens (`app.js:4780`);
  - when Nvidia hasn't provisioned the model yet, it waits and tries again (`app.js:4788`).
- **Any other error ends the reply** with "could not finish" (`app.js:4805-4820`).
- **Moving to another model** is decided by the window. The ranking is in `src/ui/model-abilities.js:118`, and the retry is a new request from the page.

**Managing context**
- **Before a message:** the chat is compacted if it's more than 80% full (`app.js:2634`, `sessions.js:506`). The summary is written by the chat's own model (`app.js:625`).
- **Within one reply:** `shrinkConversation` (`chat.js:296`) runs only when `contextChars` is set. That's `workspace ? 240_000 : 0` (`app.js:4651`):
  - the limit is fixed and doesn't depend on the model's window;
  - Chat mode is never shrunk at all.
- No code handles a provider's "context too long" answer.

**Memory**
- `memory.context()` puts every memory that's switched on into every message (`memory.js:88-92`, `app.js:2671`). That can be up to 200 entries of 400 characters.
- Saving memories automatically is opt-in (`app.js:4743`).

**The Auto model choice**
- It's made in the page, not the server:
  - `detectJob` (`model-abilities.js:90`) guesses the job by matching the message's words;
  - `scoreModel` (`model-abilities.js:66`) ranks models by matching their names, such as "mini", "pro" or "r1";
  - `preferLastAnswered` keeps the model that answered last.
- Bunny local is never picked (`model-abilities.js:120`).

**Smart and the judge**
- **Smart** is Auto only in a trusted git folder with the judge on, in the window. Everywhere else it's Ask (`folderTrust.js:83`, `app.js:2785`).
- **The judge** (`autoJudge.js:92`, `app.js:2862-2917`) can allow only what Auto would run unasked anyway, or block it. If it doesn't answer, the rest of the reply runs as Ask for 5 minutes (`app.js:2917`). That's the right direction.

**Scheduled runs** (`runDueSchedules`, `app.js:651-705`)
- A run uses the schedule's fixed model and goes through the normal chat route.
- It's look-only (Plan mode) unless the schedule was set to Auto.
- It has no fallback model and no retry, and any limit ends it.

### What stops Bunny finishing a multi-step job on its own (worst first)

**A1. One temporary provider error ends the whole job.**
- After the first step, a 429, a 5xx, a stall or a dropped connection ends the reply (`chat.js:399-404`, `app.js:4805`).
- On a 40-step job with a free or busy provider, this is the most likely way it ends.
- In the window, the person has to press retry. A scheduled run just fails.
- **Smallest fix:** wrap the call at `chat.js:129` and retry the same round up to 3 times, with backoff and `Retry-After`. Do it only for `chat.stalled`, `chat.unreachable`, 429 and 5xx, and only when the round sent no tool calls.
  - Text already streamed can stay: the next round carries on from the conversation.
  - Also send a "Retrying (2 of 3)" step, so the person sees it.
- **Next step:** when the retries run out mid-job, hand the same conversation to the next model in the Auto ranking on the server (this needs change 5).

**A2. Context overflow in the middle of a reply.**
- Chat mode never shrinks within a reply, even now that it extends to 500 steps (AGENT-FLOW F3).
- In Code mode, the 240,000-character limit is about 60,000 tokens. That's more than a 16k or 32k model can hold (Bunny local, small free models).
- A long research or browser job overflows, and the reply ends with the provider's error.
- **Smallest fix:**
  - set `contextChars` from `modelContextLimit()` (`app.js:568`), at about 3 characters per token × 0.6, for every mode;
  - on a "context length" error, shrink to half and retry the round once.

**A3. Nothing makes it check its work.**
- A Code reply can finish with "done" after editing files and running nothing.
- **Smallest fix:** in `onReplyEnd`, when this reply wrote or edited files and no `run_command` came after the last edit, nudge once: "Run the project's own checks (tests, build or lint) and fix what fails before you finish."
  - It's the same mechanism as the open-tasks nudge.
  - It does nothing when the project has no check to run.

**A4. Chat-mode jobs aren't nudged.**
- `if (!workspace || …) return null` (`app.js:4685`) skips the open-tasks nudge in Chat mode. So a research job that stops with open tasks just stops.
- **Fix:** drop `!workspace` from the open-tasks branch, and keep it for the permission-question branch.

**A5. Scheduled runs and helpers have no fallback model.**
- The ranking and the fallback live in the page (`model-abilities.js`), so nothing on the server can choose a second model.
- **Fix:** move `detectJob`, `rankModels` and `scoreModel` to `src/shared/` (pure functions, no DOM). Then the server can rank models for schedules, helpers and A1's handover.

**A6. Auto picks models by matching their names.**
- `scoreModel` scores names (`/mini|nano|lite/` down, `/pro|r1/` up), and `detectJob` matches English words.
- A non-English message is always "chat", and a new model family gets the default score.
- **Better:** score by what the provider reports (tools, vision, context, price), plus a small table of models known to be good. Those reported abilities are already read in `modelAbilities`. Keep the name rules only as a tie-break.
- The risk is LOW, but it changes which model people get, so it needs a before-and-after table over the real model lists.

**A7. Every memory is sent with every message.**
- At 200 entries that's about 20,000 tokens per message. Small models fill up, and memories that don't apply distract.
- **Fix:**
  - send only what fits in about 4,000 characters, chosen by newest first plus words shared with the message;
  - add a `search_memory` tool for the rest.

**A8. The progress file depends on the model.**
- `.bunny/progress.md` is requested in the prompt only. When a job is continued, nothing reads it back unless the model does.
- **Fix:** when a Code chat has the file, Bunny adds it to the context itself, the same way it carries the task list over (`app.js:2815`).
- This is useful but optional: the task list already survives between replies.

---

## 2. Simplification

| Hotspot | Evidence | Verdict | Risk |
|---|---|---|---|
| `src/server/app.js` | 5,163 lines (398 KB). One `route()` function holds about 148 routes (`path ===` or `path.match`). The chat route alone runs from about line 2,580 to 4,830 (about 2,250 lines), with `runTool` inside it. | **Split, keep behaviour.** Move the routes to modules by area (settings, sessions, local-models, remote, MCP, plugins, schedules), using one shared check for window-only and device access, and move the chat turn to `chatTurn.js` with `runTool` in its own module. Use move-only commits, so each review is mechanical. | MEDIUM (it touches every lane's work, so do it when the lanes are quiet) |
| `src/ui/chat.js` | 4,990 lines (260 KB) | **Split by part:** the message list, the composer, the panes, the cards and the model picker | MEDIUM |
| `src/ui/settings.html` | An inline script of 1,154 lines | **Move it to `settings.js`,** so it can be linted, tested and loaded by tests | LOW–MEDIUM |
| The window-only list, held twice | `src/ui/api.js:29` is "a copy of src/server/windowOnly.js", and `test/window-only.test.js` keeps the two equal | **Merge** into `src/shared/windowOnly.js`, served to the pages as it is | HIGH (it's a security control, so it needs the owner's go and Security's review) |
| Bunny local, built twice | `localModels.js` is the fake one, used by e2e; `localModelsReal.js` is the real one, covered by unit tests only | **Merge** into one implementation with a pretend process runner and downloader plugged in | MEDIUM |
| Scheduled runs, two paths | In fake mode, a scheduled run skips the real chat route (`app.js:670` and `686-704`) | **Remove the fake branch:** `streamChat` already has a stand-in for the provider | LOW |
| Setting keys that are really text labels | `aiDesktopName`, `aiDesktopDesc`, `buildName`, `buildDesc`, `fallbackName`, `fallbackDesc` and `toolsTitle` are in `ORDINARY_SETTING_KEYS` (`settingKeys.js:10`). They're label names in `i18n-agent.js:89-95`, and no code reads them as settings. | **Remove them** from the list | LOW |
| Modules no test imports directly | `commandSplit.js` (285 lines: it splits commands for the permission rules), `computer.js` (229), `ocr.js` (117), `scheduler.js` (117), `terminal.js` (76). They may be covered through the routes: UNKNOWN. | **Keep, and add tests,** with `commandSplit` and `scheduler` first | LOW |
| The number of settings | About 39 ordinary keys plus 43 window-only keys | **UNKNOWN** which ones nobody needs. That's for Design and QA to judge against Claude's settings; I won't guess. | n/a |

---

## 3. Reliability: bugs that keep coming back

The history to bb229a0f has 1,250 commits. Of those, 45 mention window-only, 45 mention fake or stand-in, and 10 mention stale data or reading again.

**R1. A value is read once and trusted until the end.**
- **Evidence:** all three were found in v0.1.16:
  - the provider was read before `ensure()` (f7c917cc);
  - the idle timer didn't see calls in progress (T1, ec6358a6);
  - the status read raced a state change (434eab71).
- **The pattern:** `let settings` (`app.js:529`) is one shared object that changes in place. Long replies close over it, and over `provider.baseUrl` and the key, both passed to `streamChat` as values (`app.js:4629-4630`).
- **Structural fix:** pass things that can change during a reply as functions that are read on each round, not as values captured at the start. Examples are `baseUrl: () => …` and `apiKey: () => …`, read in `streamRound`. Make the settings a frozen copy that's replaced on change, not edited in place, so a reader sees either the old copy or the new one.

**R2. Fake mode hides what the real app does.**
- **Evidence:**
  - the server has 21 `fake` branches;
  - in fake mode, `streamChat` skips the real loop unless the message has a `[[call …]]` line (`chat.js:65-71`);
  - there are two Bunny local implementations;
  - scheduled runs take a separate fake path.
- **The cost:** SC-f (a window-only read with a plain fetch) and the stale provider passed every e2e run, because fake mode took a different path.
- **Structural fix:**
  - keep the pretending at the outer edge only: a stand-in provider server, a pretend process runner and a pretend downloader;
  - remove every `if (fake)` from the app's logic;
  - add a gate check that counts `fake` in `src/server/` and fails if the count goes up.

**R3. Window-only routes.**
- **Evidence:** 45 commits. These failures are recent:
  - a page read a window-only route with a plain fetch (SC-f);
  - the two copies of the list drift apart;
  - the page and the main process treat a `?query` differently (my note on 3ab0e22d).
- **Structural fix:**
  - one shared list (Simplification, the window-only row);
  - one page function, `api(method, path, body)`, that decides between the bridge and a plain fetch for every call, replacing `getJSON` and `sendJSON`;
  - the main process reads the path with `new URL()` the same way the server does.
- **A gate check to add:** open every page in the real Electron window with the request guard on, and fail on any 403. O8's walk does this in a browser, which is how SC-f got through.

**R4. Errors are recognised by their wording.**
- **Evidence:** these all read error text with regular expressions:
  - `affordableTokens(err.message)`, `notProvisioned(err.message)` and `modelSpecificFailure(err.message)` (`app.js:4778-4796`);
  - a scheduled run's error, read out of the response text (`app.js:680`).
- When a provider changes its wording, the handling silently changes too.
- **Structural fix:** `streamRound` throws an error with fields: `status`, `retryAfter`, `kind` (rate, auth, context, provisioning, money or other), plus the provider's text. Everything else reads the fields. A1 needs this anyway.

---

## Not covered

- I didn't check whether each feature works (QA's part), the look of the screens (Design's part), or a detailed comparison with Claude's own features (Researcher's part).
- I didn't read the Claude Code and Codex engines (`src/server/engines/`). They have their own loops and limits.
- All line counts are at bb229a0f.
