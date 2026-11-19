# CLI-ENGINES: signed in or out, per engine (Codex account mode, Gemini CLI local mode)

Researcher, 2026-11-19. Official docs, the vendors' repos and the registries only; nothing installed or run, no one signed in. UNKNOWN where a page did not say. Asked by the Chief of Staff for the owner's line: "there should be an option to use all engines both signed in and out. with recomendations where applicable."

## 1. Codex CLI, account mode ("Sign in with ChatGPT")

| Question | Answer | Source |
|---|---|---|
| Does ChatGPT sign-in work with `codex exec`? | **Yes.** "By default, `codex exec` reuses saved CLI authentication." `CODEX_API_KEY` can override it for one run. `--json` gives JSON Lines events (`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`). The page states no plan restriction for `exec`. | [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) |
| Does it work with `codex app-server`? | **UNKNOWN as a statement.** The app-server README documents account methods around a ChatGPT login: `account/read` (returns a `userId` "for ChatGPT" sessions), notifications `account/login/completed` and `account/updated`, `account/login/cancel`, `accountSession/list` and `accountSession/switch` ("a managed ChatGPT login"). It does not document `account/login/start` or `account/logout` in the text I could read, and it does not say whether app-server reads the `auth.json` a CLI login saved. So the safe plan: sign in with `codex login` in a visible terminal, then let app-server read the saved login, and prove it in the spike. | [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) |
| Where are the credentials? | `auth.json` under `CODEX_HOME` (default `~/.codex`), or the OS credential store, set by `cli_auth_credentials_store`: `file`, `keyring`, `auto` (OS store if available, else file) or `ephemeral` (memory only). "The CLI and extension share cached login details." | [auth](https://learn.chatgpt.com/docs/auth) (redirect from developers.openai.com/codex/auth) |
| How does it sign in on a PC with no browser? | `codex login --device-auth` ("beta", "preferred"); it "must be enabled in ChatGPT security settings or workspace permissions". Fallbacks: copy `auth.json`, or forward the callback on `localhost:1455`. A browser sign-in on the same PC is the normal path. | same |
| Free? | **Partly known.** The pricing page says Codex is included in Free, Go, Plus, Pro, Business, Edu and Enterprise plans. The Free plan's usage limits are **UNKNOWN** (the table covers Plus and Business only). Whether the CLI is included on Free and Go: **UNKNOWN** (the page lists the CLI for Plus, Pro and API key only). API-key use is billed per use, not free. | [pricing](https://learn.chatgpt.com/docs/pricing) |
| Is it safe in other ways? | Treat `auth.json` "as a password"; "Don't use ChatGPT-managed auth for public or open-source repositories"; for CI the docs recommend an API key. Project config and MCP servers load only for trusted projects; `--ignore-rules` skips execpolicy rules. | [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) |

**What this means for Bunny (CE-3).**
- `CODEX_HOME` must be Bunny's isolated per-engine, per-mode home, so the login lands in `auth.json` there and never mixes with the person's own `~/.codex`. Set `cli_auth_credentials_store = "file"`: with `keyring` or `auto` the login would go to the OS store, where Bunny cannot keep account and local modes apart, and where it may collide with the person's own Codex login (UNKNOWN whether the keyring entry is keyed by `CODEX_HOME`; Security should decide).
- Bunny never opens `auth.json` (CE-3.1); it asks the CLI's own status output. The status command's exact name and output: UNKNOWN (not read).
- ChatGPT sign-in tokens refresh in place (the CI page says "persist the file Codex refreshes"), so the file changes during runs.

## 2. Gemini CLI, local mode and account mode

### Can it be pointed at a custom endpoint that speaks Gemini's shape?

**Yes, for the Gemini API shape only.**
- `GOOGLE_GEMINI_BASE_URL` "overrides the default base URL for Gemini API requests"; "it must use HTTPS unless pointing to `localhost` (or `127.0.0.1` / `[::1]`)". [configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md).
- The source shows it has its own auth type: with `GOOGLE_GEMINI_BASE_URL` set (and neither the Google nor Vertex flags), the auth type is **`gateway`**. A gateway accepts an API key from the argument or `GEMINI_API_KEY`, **or none** (`apiKey || getEnv('GEMINI_API_KEY') || ''`; an empty key sends an empty `x-goog-api-key`), plus optional custom headers. So no Google account and no real key are needed. [contentGenerator.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/contentGenerator.ts) (read from `main` on 2026-11-19; re-check at the pinned tag).
- What Bunny's loopback listener (CE-4) must then serve is the Gemini REST API: `POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent` (both documented), with `contents`, `systemInstruction`, `tools[].functionDeclarations`, `generationConfig` in; `candidates[].content.parts` (text or `functionCall` with `name`, `id`, `args`) and `usageMetadata` out. [API reference](https://aistudio.google.com/api-reference/generate-content). Not read: the streaming format details (the SDK may ask for `alt=sse`), `thought` parts, and `functionResponse` turn format.
- The CLI's own content-generator interface also has `countTokens` and `embedContent` (visible in its test generators). Whether a plain headless run calls them, and whether a second small "router" model is called (a `model-routing` doc exists, not read): **UNKNOWN**. The spike must log every path the CLI requests at the fake upstream, and Bunny's adapter must answer or refuse each one with a clean error.
- It is **new translation work**: Gemini wire shape to Bunny's OpenAI/Anthropic-shaped models, tool calls both ways, streaming, token counts. The spec's CE-4 rules (loopback only, token by environment, ignore the model name) carry over, but the token travels as the "API key" header here, which is acceptable (it is a per-run secret).

### Account mode: Google sign-in and its limits

- Three routes: Google sign-in (`oauth-personal`), a Gemini API key, Vertex AI. [auth types in source](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/contentGenerator.ts).
- **Free limits (quota page):** Google sign-in ("Gemini Code Assist for individuals"): **1,000 model requests per user per day**; per-minute figure not given. A Gemini API key on the unpaid free tier: **250 requests per user per day, Flash model only**. No change notice on the page. [quota and pricing](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/quota-and-pricing.md).
- Whether prompts are used to improve Google products: the CLI's own privacy page does not say; it points to the Code Assist for individuals Privacy Notice and the Gemini API unpaid-services terms (not read). Mark: **UNKNOWN**, and the owner should read those before choosing account mode. [tos-privacy](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md).
- Where sign-in credentials go: not read; `GEMINI_CLI_HOME` moves the user config folder, so the isolated home rule (CE-3.3) is satisfiable. UNKNOWN: the credential file name.
- R4 (free only): the Google sign-in tier is free today, "if the free tier died tomorrow" account mode stops but local mode (with the adapter) would not.

## 3. Recommended mode per engine

"Local" = Bunny's models through Bunny's loopback endpoint, no account. "Account" = the vendor's own sign-in, Bunny never reads the credential (CE-3.1). Each engine offers both where it can; this is the one Bunny should show first.

| Engine | Recommended first | Why | The other mode |
|---|---|---|---|
| **Claude Code** | **Account** (the person's Anthropic sign-in) | The owner already made this exception. Claude Code's custom endpoint needs the Anthropic Messages shape and "non-Claude models are not supported" by Anthropic (see CLI-ENGINES report, 0e71850), so local mode is a "not supported by Anthropic, may break" note, as the spec says. | Local: only with an Anthropic-shaped endpoint and Claude-compatible models. |
| **Codex CLI** | **Local when the owner's provider serves the OpenAI Responses API; otherwise Account** | Codex local mode needs `wire_api = "responses"` (earlier report), and which of Bunny's providers serve `/v1/responses` is UNKNOWN. ChatGPT sign-in works with `exec` and the plans are listed as including Codex, but Free-plan limits are UNKNOWN and an API key is paid. | Account: sign in with `codex login` into the isolated `CODEX_HOME`; local: Responses-capable providers only. |
| **Gemini CLI** | **Account** (Google sign-in, 1,000 free requests a day) until a Gemini-shape adapter exists | Local mode needs Bunny to translate the Gemini API: new work. The free sign-in tier is the only no-cost path today; its data terms must be read by the owner. | Local: via the `gateway` base URL and an adapter, later. |
| **OpenCode** | **Local** | Takes any OpenAI-compatible endpoint with a key from the environment, no account in the example; ACP and the server API give the host approval channel. Its own hosted route needs a vendor sign-in; not read, not needed. | Account: not offered unless the spike finds a reason. |
| **Goose** | **Local** | Many OpenAI-compatible providers, telemetry off by default, ACP permission requests; no account is part of its design. | Account-style provider logins exist for some vendors: not read, not needed. |
| **Qwen Code** | **Local** | `modelProviders` with `baseUrl` and `envKey` for OpenAI/Anthropic protocols; the key is read from the environment. Its own sign-in is now a subscription ("Qwen Account with Subscription"), not a documented free tier, so account mode has no R4 case. | Account: Qwen's own sign-in or Alibaba Cloud Coding Plan, paid: UNKNOWN prices. |

**For the settings screen.** Show, per engine, a two-way choice (Signed out: Bunny's models. Signed in: the vendor's account) with the recommended one marked and a one-line reason from the right-hand column. For Gemini CLI, grey out "Signed out" with "needs a Gemini adapter (not built)" until it ships; for Codex, show "Signed out" only for providers that pass the Responses check.

## Not verified

`account/login/start`, `account/logout` and the exact status command in Codex's app-server and CLI; whether app-server reads a CLI-saved `auth.json`; whether Codex's keyring entry is keyed by `CODEX_HOME`; Codex Free and Go plan limits and CLI inclusion; Gemini's streaming query form, `countTokens`/`embedContent` use and any router-model call in a plain run; the Gemini sign-in credential file name; the data-use terms for both Gemini free routes; Bunny providers that serve `/v1/responses`; Qwen account prices. Pages were read through a summarising fetch tool and the GitHub API on 2026-11-19; the source file was read from `main`, not a release tag.
