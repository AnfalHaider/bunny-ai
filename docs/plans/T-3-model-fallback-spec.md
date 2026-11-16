---
title: T-3 spec — model switching, Auto, and a calm offline state
author: tech-lead
date: 2026-11-16
risk: MEDIUM (the shared send loop and the reply route; no data schema, no security control)
owner_words: "the model switching and auto model needs to be fixed. if my local network is down, only then it should behave differently, but that to with grace." (via the Chief of Staff, 2026-11-16)
evidence: the owner's screenshot — "deepseek-ai/deepseek-v4.1-flash could not finish: The provider did not answer in time", shown twice, reply stopped
code_read_at: 06b06b4 (0.1.4)
for: Design (the two small screens), Builder (the change), QA (walk), Tech Lead (diff review)
---

# T-3: when a model fails, move on quietly; only a dead network gets its own state

## What the owner sees today, and why (read in the code)

| What happened | Where it comes from |
|---|---|
| The reply waits two minutes, then fails | `DEFAULT_STALL_MS = 120_000` (`src/server/chat.js:20`) covers the wait for the first byte and every gap after it. One silent provider costs 2 minutes **per model tried**. |
| The error line appears **twice** | Each failed attempt is saved in the chat as an error note (`app.js:2419`, `kind:'error'`, text "<model> could not finish: <reason>") **and** the page also writes the same message into its own error line (`chat.js:1392`, `$('error')`). After the reply route finishes, `refreshSession()` repaints the saved note, so the live line and the saved note both show. With a fallback in play, each failed hop also leaves its own saved note. |
| The reply "stopped" with no way on | The loop (`chat.js:2007-2034`) has at most 4 candidates in Auto and 1+2 when the person picked a model, **chosen up front by score only** (`rankModels`, `model-abilities.js:96`). If the provider is down, the top candidates are usually its other models: they stall too, and the loop ends on the last failure. |
| Fallback is silent about why | The note reads "<from> is busy: asking <to>" (`model.fallback`, `i18n-agent.js:13`) for every cause, shown as a 6-second toast, and the saved line says "Answered by X because Y was busy" (`i18n-agent.js:15`). A timeout is not "busy". |
| No idea whether this computer is offline | Nothing tests it. A dead network surfaces as `chat.unreachable` ("Could not reach <url>", `chat.js:~172`) or as a stall, and the loop treats both like a model fault, then tries every candidate in turn. `navigator.onLine` is not read anywhere. |
| Work already done is lost | A failed hop saves no partial text (`app.js:2386-2421` saves only when the person pressed Stop). Tool steps are saved as they run, and `history.js:96` already knows how to continue a cut-off reply (`CONTINUE_NOTE`), but only for `kind:'partial'` messages, which this path never writes. |

## Behaviour to build (one rule set)

### 1. Classify every failure into three kinds (server decides, sends it in the `error` event as `scope`)

| scope | Causes | Next step |
|---|---|---|
| **model** | no first byte in time (`chat.stalled`), 429 or "rate limit"/"overloaded", 404 "model not found" (already marks the model unavailable), empty reply, `finish_reason: content_filter` or a refusal with no content, 5xx for one model | switch to the next suitable model |
| **provider** | `chat.unreachable` while the network is up, 401/403 (`chat.unauthorized`), 5xx on several models, a stall on two different models of one provider | switch to a model of a **different provider**; skip that provider's other models for the rest of this send and for the next 5 minutes (cool-down, see 3) |
| **device** | no network at all (see 4) | **no model switch**; the offline state |

Errors that are not about the model stay as today (`speech.failed`, `model.notSelected`, `provider.notConnected`, `request.invalidJson`: `chat.js:2004`).

### 2. Switch quietly, with one line, continuing where it stopped

- Choose the next model **after** a failure, not up front: best remaining by `rankModels` for the job, excluding the model that failed, excluding any provider in cool-down, excluding `unavailable`. Maximum 3 attempts per send (first pick + 2); the cap and the order are one constant each in one file.
- No toast with the old wording. The reply that finally lands carries one line under it: "Answered by <model> because <from> did not answer in time" (reason words per `fellBackReason`: `timeout`, `rate-limit`, `unavailable`, `empty`, `refused`). If two hops failed, still one line: the first failed model and the reason, "(tried 2 other models)". Extend `fellBackFrom` with `fellBackReason` and `fellBackTries` in `answeredBy` (`app.js:2288`) and in the meta line (`chat.js:1037-1042`); add the translations next to `model.answeredInstead` (all four languages in `i18n-agent.js`).
- **Continue from what was done:** when a hop fails after some text arrived, the server saves that text as `kind:'partial'` (so `history.js:63,90` adds the existing "stopped before it finished" mark and `CONTINUE_NOTE`), then the next model carries on. Tool steps are already saved. When nothing arrived, nothing is saved. The page does not wipe the reply box with `…` (`chat.js:2033`); it keeps what was shown until the next model's first words arrive.
- If every allowed attempt fails, say it once: a single error line, with the real reason and what to do ("Nothing answered. Try again, or pick a model."), plus a Retry button on the line. No second copy.

### 3. Remember which provider just failed (health, in memory only)

- `providerHealth: Map<providerId, { until, reason }>`, set on a provider-scope failure with a 5-minute cool-down, cleared by any success from that provider. Held in the server process; not saved to disk, not shown as a permanent "unavailable" tag (that is for "model not found" only, `unavailable.js`).
- Ranking for Auto and for fallback drops providers in cool-down unless nothing else is left. A model the person picked **by hand** is still tried first (their choice), but with the short first-byte limit below.
- The next message in the same chat starts from the model that last answered, not from the one that failed (`state.autoPick`, `retryPick`, `chat.js:1821`, update it from `done.model`).

### 4. Offline is its own state, decided once, and only then

- **How we know.** Two signals, either one is enough to *check*, both must agree to *declare*:
  1. The window's `navigator.onLine === false`, or an `offline` event, checked before sending and when a hop fails with `chat.unreachable`/a stall.
  2. A probe, `GET /api/network` (new, token-guarded like every route, see S-1), which tries a small set of neutral HTTPS endpoints in parallel with a 3-second limit each and reports `{online}`. Offline only if every probe fails **and** DNS fails. The probe sends no data from the person: a bare request. The endpoint list lives in one array; the owner should know it exists (it contacts a neutral host to learn about the network), so it goes in the help text for the setting and is listed here as an open point, not hidden.
  The probe runs **only after a first failure**, never on every send.
- **What it does.** The reply stops trying other models (they would fail the same way), saves nothing as an error, and shows a calm line in the chat: "You're offline. I'll send this when the network is back." The typed message stays queued (one pending turn), the bunny shows its resting pose, no red. The page listens for `online` and also re-probes every 10 seconds, easing to 30; when the network is back it sends the queued turn once, unless the person stopped it or typed something new.
- **Graceful extras.** Models served from this computer (a provider whose address is loopback, see `connections.js:19`) still work offline: in the offline state Auto prefers them, and the line says "Using <model> on this computer". If there are none, only the queue.

### 5. Timeouts (one place, `src/server/chat.js`)

- First byte: 30 s (reasoning models, ids matching `reason|think|r1`, and image or video jobs: 60 s). The value is a constant with the model-class override beside it, passed into `streamRound` (it already takes `stallMs`).
- Between chunks once streaming: 60 s. Thinking tokens count as activity (they do today, because each `reader.read()` resets the timer).
- These numbers are a starting point; they are the one thing the owner may want to tune, so they are named constants with a comment, and the unit tests inject small values instead of waiting.

## No-duplicate rule, stated for the code

1. The server saves an error note (`kind:'error'`) only when there is **no further attempt**. The page tells it: the payload gains `attemptsLeft` (the number of fallbacks still allowed after this one); the server persists the note only when it is 0.
2. The page shows the live error line only for the final failure and clears it once `refreshSession()` has painted the saved note (or it paints it and does not save one for that turn). A reload therefore shows exactly one line.
3. Painting drops a saved error note that is identical to the one directly above it (defence for old chats that already hold doubles).

## Files (for Builder)

| File | Change |
|---|---|
| `src/server/chat.js` | First-byte and gap timeouts (constants, model-class override); classify errors with a `scope`; `finish_reason: content_filter` and empty replies become `chat.empty`/`chat.refused` model errors. |
| `src/server/app.js` reply route (`:2296-2424`) | Add `scope`, `fellBackReason` into `answeredBy`; save `kind:'partial'` on a failed hop that produced text; persist the error note only when `attemptsLeft` is 0; maintain `providerHealth`; new `GET /api/network`. |
| `src/ui/chat.js` | Replace the up-front candidate list (`:1992-2034`) with a lazy `nextCandidate()`; read `scope` from the `error` event (`streamInto`, `:1392`); offline detection, queue and resume; one error line; update `state.autoPick` from the answering model; stop wiping the box with `…`. |
| `src/ui/model-abilities.js` | `rankModels(models, job, { avoidProviders, preferLocal })`. |
| `src/ui/i18n-agent.js` | Strings for the reasons, the offline line, "Using <model> on this computer", "Nothing answered" (all four languages). |
| `src/providers/offline.js` (the fake upstream) | Test models that stall, answer 429, answer empty, answer 500 and refuse the connection (`fake-stall`, `fake-429`, `fake-empty`, `fake-down`), so the e2e suite exercises the real loop. |
| Design | Two small views: the one-line meta under a reply that changed model, and the offline line with its queued message (both themes, phone and desktop; O3 says drawn first). Tech Lead and Builder wait for the picture. |
| Help | The Settings text for "when a model is busy" (`settings.html:280`, `fallbackWhenBusy`) says what now triggers a switch and mentions the network probe (O7). |

## Tests (write first, red then green)

Unit and route level use injected small timeouts and a fake upstream; e2e uses the new fake models.

| # | Case | Expected |
|---|---|---|
| T3-1 | Model stalls (no first byte) at the injected limit | `error` event has `scope:'model'`, `code:'chat.stalled'`; the next hop starts without waiting the old 120 s (assert elapsed under a few seconds with small limits) |
| T3-2 | 429, "overloaded", 500 on one model | switches to the next suitable model; one meta line on the final reply; **zero** saved error notes |
| T3-3 | Empty reply; `content_filter` | treated as model failure; next model answers |
| T3-4 | A model fails after sending 40 words | the 40 words are saved as `partial`; the next model's request contains the continue note; the final transcript reads continuously, no `…` wipe |
| T3-5 | Provider down: two stalls on two models of one provider | the third attempt is on a **different** provider; that provider is skipped for the next send within 5 minutes; a success clears the cool-down |
| T3-6 | Manual pick that fails | the picked model was tried first; fallback follows; with `fallbackWhenBusy` off, one clear error and no switch |
| T3-7 | Everything fails (all attempts) | exactly **one** error line, live and after reload; one saved note; a Retry button |
| T3-8 | **No duplicates**: the same failure as the owner's screenshot (a stall on one model, then the fallback also fails) | count of `.error-note` plus live error lines for that turn is 1 |
| T3-9 | Old chat holding two identical consecutive error notes | paints one |
| T3-10 | `navigator.onLine=false` (Playwright `context.setOffline(true)`) then send | no model attempt is made (assert no request to the provider route), the offline line shows, the text is queued, composer is usable |
| T3-11 | Back online (`setOffline(false)`) | the queued message is sent once and answered; no duplicate user message |
| T3-12 | Offline state, person types a new message or presses Stop | the queued turn is cancelled, not sent later |
| T3-13 | Provider unreachable but the network probe succeeds | scope `provider`, switches provider; **not** the offline state |
| T3-14 | Probe: all endpoints fail | `{online:false}` in about 3 s; one slow endpoint does not hold the answer past the limit; a malformed endpoint entry does not throw |
| T3-15 | Offline with a loopback provider connected | Auto picks it and says so; without one, queue only |
| T3-16 | Auto next send | starts from the model that last answered, not the one that failed |
| T3-17 | Existing suites | `npm test`, `npm run test:e2e`, `node scripts/gate.mjs`; paste output (O1, O2) |

## Risks

- **Switching to a model the person did not choose** changes cost and quality. It is already the shipped behaviour (`fallbackWhenBusy`, default on); this makes it faster and clearer. The meta line is the receipt.
- **A stall limit that is too short** cuts off a slow but healthy model. The 30/60 s split and the "thinking counts as activity" rule are the guard; the constants are in one place.
- **False offline.** Two signals must agree before the state shows, and the probe runs only after a failure. A captive portal that answers every probe looks online; the provider error then stays a provider error (acceptable, the message is still honest).
- **Queue and resend** must never send twice: one pending turn, an id, cleared before sending.
- **The probe contacts a neutral host.** Disclosed above and in help text. No chat content, key or profile detail is sent.

## Not in this spec

Cost caps per fallback, a per-model "do not fall back to" list, and a UI to see provider health (all possible later rows). Scheduled tasks use the same reply route and get the new behaviour with no extra work; their own offline handling (skip and mark "offline", retry on the next tick) is one line to add in `runDueSchedules` and goes in the same build.
