# Bunny AI — build status

Dated: 2026-11-12. Every claim below has the command that produced it underneath.

## What runs today

`npm start` → `http://127.0.0.1:5173/` (data in `%LOCALAPPDATA%\BunnyAI`).

Zero dependencies at run time: plain Node for the server, plain ES modules for
the interface. No build step.

| Area | State | Evidence |
|---|---|---|
| Provider catalogue (10 providers, Nvidia first) | works | `e2e/app.spec.js` "every provider … is listed" |
| Connect / disconnect, key masking, probe honesty | works | `test/providers.test.js`, `test/probe.test.js` |
| Sign-in for OAuth providers (device code) | works | `test/oauth.test.js` |
| Model discovery + offline cache | works | `test/discovery.test.js`, `test/api.test.js` |
| Local model servers (Ollama, no key) | works | `test/local-models.test.js` |
| Model picker: grouped, searchable, keyboard, aria | works | `e2e/features.spec.js` "the model picker is driven from the keyboard" |
| Model picker (W4-13): one row per model, every provider a tag (Free, Free daily), Filters (provider, can do, Free only), Favourites and Recent, a Details panel to put the providers in your order (kept on this computer) | works; thinking choice and automatic switch to the next provider not built yet | `e2e/w4-13-picker.spec.js` |
| Chat with token streaming (SSE), stop, retry, edit | works | `e2e/features.spec.js` |
| Markdown, code blocks, syntax highlighting | works | `e2e/features.spec.js` "code in a reply is highlighted" |
| File and image attachments | works | `e2e/features.spec.js` "a file can be attached to a message" |
| Context meter and automatic compaction | works | `test/context.test.js` |
| Artifacts beside the chat: versions, restore, charts, print | works | `e2e/features.spec.js`, `e2e/extras.spec.js` |
| Branching, nesting, projects, pin, archive, rename | works | `test/structure.test.js`, `e2e/features.spec.js` |
| Search, import, export, command palette | works | `e2e/workspace.spec.js` |
| Memory, MCP tools, schedules, hooks, skills | works | `test/automation.test.js`, `e2e/automation.spec.js` |
| Four languages, right to left included | works | `e2e/shell.spec.js` |
| Notifications, pop-out window, installable as an app | works | `e2e/shell.spec.js` |
| Secrets encrypted per user (Windows DPAPI) | works | `test/secretStore.test.js` |
| Test mode (`BUNNY_FAKE_UPSTREAM=1`) fully offline | works | the whole e2e suite runs with no network |

## Feature tally

`docs/FEATURE-TALLY.md` is generated from `docs/features.js` by
`scripts/feature-tally.mjs`, and `test/tally.test.js` fails if the committed
file is stale or if a row marked done names a test that does not exist.

**72 of 74 features are done and covered by a test.** The two that are open are
open on purpose:

| Feature | Why it is open |
|---|---|
| Computer use | needs OS-level control and an entitlement |
| Plugins and marketplaces | a plugin would mean running third-party code; this app runs none |

## Test evidence

```
$ node --test test/
ℹ tests 204
ℹ pass 204
ℹ fail 0

$ npx playwright test
Running 62 tests using 1 worker
  …
  62 passed (1.5m)
```

The browser suite starts its own server in test mode on its own port (BUNNY_E2E_PORT, else a free one picked per run) with a
throwaway profile, so a run never touches the real profile.

## Bugs the tests found

1. Ten "＋ Connect" buttons were announced identically to a screen reader: the
   element helper used `Object.assign`, which sets JS properties and never
   reflects `aria-*` onto the DOM. Fixed in `src/ui/providers.html`.
2. A click on a provider's connect button was lost to a full re-render, and
   whatever had been typed was thrown away. The forms now stay in the DOM and
   are shown by toggling `hidden`.
3. `form.inline { display: grid }` beat the browser's own `[hidden]` rule, so
   all ten connect forms were visible at once.
4. Pressing Stop threw the reply away. The server now keeps what had arrived
   and marks it as stopped.
5. A retry deleted the reply and then streamed into nothing, because there was
   no bubble left to stream into.
6. The automation screen showed every toggle as "on": a parameter named
   `onToggle` held the callback, so the flag was always truthy.

## What is NOT built

Nothing on the list of the reference app's own features is missing except the two
rows above. What the app does not do:

| Thing | State |
|---|---|
| Run third-party code (plugins, scripts from a chat) | not done, on purpose |
| Control the computer | not done, on purpose |
| Update itself | it can check a version feed you configure; it never installs anything |
| Speak aloud or listen | it uses the browser's own speech, where the browser has it |

## Provider connections fixed — 2026-11-14

The Nvidia, OpenRouter and Google keys were "connected but not working". The
causes, each proven with the real keys and now covered by tests in
`test/provider-shapes.test.js`:

1. **Provider errors were thrown away.** A chat failure reported only "the
   provider answered 404". The provider's own explanation (rate limit, credits,
   end of life) is now read from the response body and shown (row 2.18).
2. **Anthropic pointed at the wrong address and header.** Its OpenAI shape is
   `/v1/chat/completions` and the model list wants `x-api-key` (row 2.14).
3. **Google pointed at its native API.** Gemini's OpenAI-compatible API lives
   under `/v1beta/openai`, and its native list names models `models/x` (row 2.14).
4. **A bad Google key was waved through.** Google's compatible model list
   answers 404 without a key; the probe now tests the key when the anonymous
   call is inconclusive (row 2.19).
5. **OpenRouter refused big requests.** When the provider says how many tokens
   the balance covers, the request is retried with that number (row 2.16). With
   this, Anthropic Opus via OpenRouter streams a real reply.
6. **Nvidia's first call 404s.** Some of its catalogue is not reachable for
   every account ("not found for account"); the request is retried once and,
   if it stays dead, the model is marked unavailable in the picker with the
   reason (rows 2.15, 2.16).
7. **A silent provider hung the chat forever.** Some Nvidia models accept the
   request and never stream. Silence over 120 s is now an error, not a wait
   (row 2.17).

Verified live with the owner's keys on 2026-11-14: Nvidia
(`nvidia/nemotron-3.5-lightning-30b-a3b`) and OpenRouter
(an Anthropic Opus model, free Ernie) both stream and save. Google
needs its key re-entered; a bad key is now refused with the provider's own
message instead of connecting.

Tests at close: 219/219 unit, 62/62 browser. Tally 78/80 (computer use and
plugins/marketplaces stay open on purpose).

## UI/UX redesigned to feature parity �?" 2026-11-15

The chat shell was rewritten to look and behave like the reference app, while
keeping every tested ID, i18n key and aria-label intact so no e2e selector
broke:

* **Warm palette:** ivory canvas `#faf9f5`, oat sidebar `#f0eee6`,
  ink buttons, clay brand `#d97757`; a full dark set (`#262624` family) for
  `html[data-theme="dark"]` and `prefers-color-scheme` fallback.
* **Serif greeting:** time-based "Good morning / afternoon / evening" on the
  empty state, with the composer card centred (`padding-bottom` grows with
  viewport height).
* **Composer card:** rounded transparent-border textarea, pill-shaped model
  picker that opens **upward** with two-line items (model name + context
  length), circular ink send button, icon-only attach/voice/stop buttons.
* **Right-aligned user bubbles** in a soft panel-2 bubble; message actions
  are icon buttons (copy/edit/retry/branch/artifact/read-aloud) that flash
  via their screen-reader span.
* **Sidebar sections:** Starred (pinned) at the top, then project trees with
  expand/collapse headers, then Recents split into Today / Yesterday /
  Previous 7 days / Older buckets via `bucketOf(updatedAt)`.
* **Session rail:** a collapsible right panel (toggle in the topbar, state
  persisted to `localStorage`) showing Environment, Context meter,
  Connectors and Outputs (session artifacts).
* **Account footer:** avatar, name, Local tag and Settings link at the
  bottom of the sidebar.

Tests at close: 219/219 unit, 67/67 browser (5 new shell tests for the
greeting, date buckets, chat title, Starred section and the session rail).
Tally 82/84 (computer use and plugins/marketplaces stay open on purpose).
