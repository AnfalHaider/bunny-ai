# Builder - session log

Newest entry on top. Only this session writes this file.

## 2026-11-15 - Chat shell redesigned to feature parity

**Question asked:** the UI/UX was not like the reference app at all, and the reference app has
features Bunny AI didn't show.

**What I did**

- Rewrote `src/ui/app.css` with the old warm palette (light `#faf9f5` /
  `#f0eee6`, dark `#262624` family, clay brand `#d97757`), serif greeting,
  composer card, pill model picker opening upward with two-line items, circular
  ink send button, right-aligned user bubbles, icon message actions, rail,
  project tree and account footer. Every existing selector and ID preserved.
- Rewrote `src/ui/index.html`: new sidebar shell (rail toggle, account
  footer), rail panel (Environment / Context / Connectors / Outputs), topbar
  chat title, composer card structure. All tested IDs and i18n hooks intact.
- Edited `src/ui/chat.js`: `renderSidebar()` gains Starred section, project
  headers with expand/collapse, Recents date buckets via new `bucketOf()`;
  `renderPicker()` renders span.model-name + span.model-desc and a chevron;
  `renderMessage()` drops the `.who` label and tags move to a meta row;
  `renderActions()` renders icon buttons with `.sr` flash targets; `flash()`
  writes to `.sr` when present; new `paintMessages()` toggles `.is-empty`
  and paints the greeting; new `renderTitle()` writes `#chat-title`;
  new `loadMcpServers()` + `renderRail()` wired into boot, openSession,
  startNewChat, setStreaming and toggleArtifacts.
- Added 9 i18n keys to all 4 languages (greeting, today/yesterday/previous7/
  older, projects/newProject, recents, rail labels) and 5 new Playwright
  tests (greeting, date buckets, chat title, Starred, rail).

**Result:** 219/219 unit tests pass; 67/67 browser tests pass (62 original +
5 new). Tally 82/84. Verified visually in light and dark themes via
Playwright screenshots.

**Hand-over:** everything is still uncommitted. The two open tally rows
(computer use, plugins/marketplaces) remain open on purpose and await the
owner's answer on `docs/plans/BOARD.md`.

**Lesson:** L005

**Question asked:** the owner added Nvidia, OpenRouter and Google API keys and
nothing worked.

**What I did**

- Probed each provider's real endpoints and found the app was speaking to the
  wrong addresses and headers: Anthropic wanted `x-api-key` at `/v1`, Google's
  OpenAI-compatible API lives at `/v1beta/openai`, and its model list names
  models `models/x`.
- Made provider errors carry the provider's own explanation instead of "the
  provider answered 404".
- Retried the two refusals a retry can fix: OpenRouter's "can only afford N
  tokens" (asks for N) and Nvidia's "not found for account" (one more go).
- Models that stay unreachable are remembered and marked "unavailable" in the
  picker, with the reason in the tooltip.
- Added a 120 s silence watchdog so a provider that accepts a request and never
  streams is an error, not an eternal spinner.
- Tightened the connect probe: when the anonymous model list is inconclusive
  (Google's 404), the key itself is tested; a bad key is refused.
- Registered the six new behaviours as rows 2.14–2.19 in `docs/features.js`,
  regenerated the tally, and proved everything with
  `test/provider-shapes.test.js` (15 tests) plus a live check with the owner's
  real keys: Nvidia and OpenRouter both stream and save; Google needs its key
  re-entered.

**Evidence:** 219/219 unit tests, 62/62 browser tests, tally 78/80. Live SSE
transcripts from `nvidia/nemotron-3.5-lightning-30b-a3b` and
an Anthropic Opus model on port 5173.

**Lesson:** see `docs/memory/lessons/L004-provider-errors-are-data.md`.

## 2026-11-12 — feature parity, from tally to working features

**Question asked:** reverse engineer the reference app with REA, tally every
feature, then use Playwright to check the functionality is there.

**What I did**

- Read the recovered reference-app artefacts (1,474 IPC channels, 43,833 UI strings,
  44 tools) and turned them into a 74-row registry, `docs/features.js`.
- Made the tally generate itself: `scripts/feature-tally.mjs` renders
  `docs/FEATURE-TALLY.md`, and `test/tally.test.js` fails if a row marked done
  names a test that does not exist, or if the committed file is stale.
- Built the missing features, server first and then the screen: branching and
  nesting, projects with instructions, artifacts with versions and restore,
  `/compact` with a context meter, attachments, search, import, a command
  palette, four languages, memory, MCP tools called by the model, scheduled
  tasks, hooks, skills, OAuth sign-in, local model servers, pop-out windows,
  notifications and an installable app.
- Wrote the Playwright coverage as I went: 62 browser tests, one per promise a
  person would make.

**Result:** 72 of 74 features done and covered by a test. The two that are open
are open on purpose: computer use (OS-level control and an entitlement) and
plugins (third-party code). 204 unit tests and 62 browser tests pass.

**Hand-over:** the registry in `docs/features.js` is the source of truth; the
readable tally is generated. A new feature is not done until a test names it.

**Lesson:** [L001](../lessons/L001-browser-tests-find-the-bugs-the-code-hides.md),
[L002](../lessons/L002-a-stopped-reply-is-still-a-reply.md),
[L003](../lessons/L003-profile-state-leaks-between-browser-tests.md).
