# W4-13: free allowances by provider

Researcher, 2026-11-17 (all "checked" dates). Source for every row is the provider's own page or its public models API. Page text was read through a fetch tool that summarises pages, so exact numbers should be re-read on the page before they go in the UI. UNKNOWN means I could not confirm it; nothing is guessed. No key of the owner's was used; only unauthenticated public endpoints were called.

## Today's rule (src/providers/discovery.js:59)

`isFree(row, id)`: free if the id ends in `:free` or `-free`, or if `row.pricing` has `prompt` and `completion` that are both 0. Nothing else (no daily-limit notion, no other field names).

## What the rule catches, measured on public model lists (2026-11-17)

| Provider | Models listed | Free by the provider's own flag | Caught by isFree | Missed |
|---|---|---|---|---|
| OpenRouter (`/api/v1/models`, no key) | 469 | 14 ids end `:free`; 17 have prompt and completion 0 | all 14 plus the 3 zero-priced (`openrouter/free` router, two Lyria music models) | none for chat; the 2 Lyria are media, not chat |
| OpenCode Zen (`opencode.ai/zen/v1/models`, no key) | 87 | 13 have cost 0 (`cost.text.input.price` and `output.price`) | 12 by the `-free` suffix | **`big-pickle`** (cost 0, no suffix). Prices live in `cost`, not `pricing`, so the price check never fires here |
| Vercel AI Gateway (`ai-gateway.vercel.sh/v1/models`, no key) | 513 | 6 language models priced 0 (`nvidia/nemotron-3.5-lightning-free`, `reflection/beam-free`, `reflection/beam`, `recursive/flint-v1.0`, `humansand/ampersand-v0.1`, `stealth/glyph-cluster`) plus 15 image/video/rerank/transcription | the 2 `-free` ids | the other 4. Prices are `pricing.input` and `pricing.output`, not `prompt`/`completion`, so the price check never fires. Vercel's free tier is also not per-model price (see below) |
| NVIDIA (`integrate.api.nvidia.com/v1/models`, no key) | 33 | no flag in the list | none | UNKNOWN which are free; the list has only id, created, owned_by |
| Groq, Together, Mistral | 401 without a key | not checked | n/a | needs a key; not tried |

Fix suggestions for the Builder: also read `row.cost.text.{input,output}.price` (OpenCode) and `row.pricing.{input,output}` (Vercel); keep a language-type filter (`type: language`) so image/rerank zeros do not count as free chat models. Do not call a model free just because the provider has a free plan; that is a separate flag (below).

## Per provider

"Reset" is the owner's daily/monthly question; "flag" is how the model list shows it.

| Provider (catalog id) | Free allowance? | Size | Reset | Flag in model list | Source (checked 2026-11-17) |
|---|---|---|---|---|---|
| **OpenRouter** (`openrouter`) | Yes: `:free` models | 20 requests per minute. 50 requests per day with under 10 credits ever bought; 1000 per day with at least 10 credits bought | Daily, per UTC day (the page ties it to the UTC day; no clock time stated for free models) | `:free` id suffix and `pricing` 0; `GET /api/v1/key` returns `free_model_daily_requests` | https://openrouter.ai/docs/api-reference/limits ; models API above |
| **Google** (`google`, Gemini API) | Yes: free tier on some models | The page I read showed one model at 200 RPM, 50,000 TPM, 10,000 RPD, and said other models vary by model and account; per project, not per key. The numbers look unusual; re-read the page and the AI Studio limits page before using | Daily: RPD quota resets at midnight Pacific time | none found in the OpenAI-compatible model list; UNKNOWN | https://aistudio.google.com/docs/rate-limits (redirected from ai.google.dev) |
| **Groq** (`groq`) | The docs have a "Free Plan" tab, but the fetch could not tell which table is Free, so the numbers are UNKNOWN | UNKNOWN | Not stated in the text; response headers `x-ratelimit-reset-requests` (daily) and `x-ratelimit-reset-tokens` (per minute) show it | none; model list needs a key | https://console.groq.com/docs/rate-limits |
| **Cerebras** (`cerebras`) | Yes, as a trial: $5 free credits, then limits | Free Trial: `gpt-oss-120b` 5 RPM, 30K uncached TPM, 1M tokens per hour, 1M per day; `qwen-3.8-27b` 300 RPM (the two models the page lists) | Token bucket, refills continuously, no fixed reset. The free credits expire 30 days after grant | UNKNOWN (needs a key) | https://inference-docs.cerebras.ai/support/rate-limits |
| **OpenCode Zen** (`opencode-console`) | Yes: free models, each "for a limited time" | 15 models named on the docs page (Big Pickle, Iceman, Inkling 2 Small, GLM-5.3-Flash, DeepSeek V4.1 Flash, MiniMax M3.1 Flash, Beam, Flint 40B, LongCat 2.5, Hy4 flash, MiMo-V2.6-Flash, Nemotron 3 Ultra / 3.5 Lightning / 3.5 Super VL, Jev 1.13). Only stated cap: LongCat 2.5 Free 100 requests per day. Some are blocked in some countries. The page says free chat models require OpenCode as the client (whether a Bunny key works for them is UNKNOWN) | Only LongCat's cap is daily; no reset time given | `-free` id suffix (12 of 13) and `cost` 0 in the list | https://opencode.ai/docs/zen/ ; https://opencode.ai/zen/v1/models |
| **OpenCode Go** (`opencode-go`) | No free plan found. The page calls it a subscription with included usage and gives no price or windows (5-hour, weekly, monthly): UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | https://opencode.ai/docs/zen/ (points to /console/go) |
| **Vercel AI Gateway** (`vercel`) | Yes: a monthly free credit on a subset of models; it ends once credits are purchased | Amount not stated on the pricing page (UNKNOWN); per-model rate limits are lower than paid; 429 on excess | Monthly credit; it starts at the first request. Exact reset day UNKNOWN | Models page has a `freeTier=true` filter (https://vercel.com/ai-gateway/models?freeTier=true); not in the public `/v1/models` JSON that I could see | https://vercel.com/docs/ai-gateway/pricing (page dated 2026-09-08) |
| **GitHub Copilot** (`github-copilot`) | Yes: Copilot Free plan | 2,000 completions per month; "an allowance of GitHub AI Credits" (amount not given on the page I read); auto model selection only; agent mode included. GitHub Models (the free API) was **retired on 2026-07-30**, per its docs | Monthly (completions stated per month); reset date UNKNOWN | none; models come from the Copilot API | https://docs.github.com/en/copilot/get-started/plans ; https://docs.github.com/en/github-models/prototyping-with-ai-models |
| **Zhipu / Z.ai GLM** (`zhipu`) | Yes: three models priced Free: GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash | No usage cap, rate or concurrency limit stated: UNKNOWN. The catalog URL is open.bigmodel.cn (China); the page I read is the international docs.z.ai | UNKNOWN | UNKNOWN | https://docs.z.ai/guides/overview/pricing |
| **Alibaba Cloud / DashScope** (`dashscope`) | Yes, one-off: new-user quota on eligible Singapore (international) models | 1,000,000 tokens per eligible model (input plus output), tracked per model; only Singapore-region models; real-time inference only | **Never resets**: valid 90 days from activation (or model release), then void even if unused; no second quota for a new account | Eligible models show a quota bar in the console; not in the API list | https://www.alibabacloud.com/help/en/model-studio/new-free-quota |
| **Moonshot / Kimi** (`moonshot`) | No free allowance found. A $1 minimum recharge is needed to use the API; reaching $5 total recharge gives a $5 voucher. Free tier / Tier 0 limits: not in the text I got, UNKNOWN | n/a | UNKNOWN | UNKNOWN | https://platform.kimi.ai/docs/pricing/limits (redirected from platform.moonshot.ai) |
| **SiliconFlow** (`siliconflow`) | Free models exist ("rate limits for free models are fixed"), but which models and what limits are UNKNOWN (the page says to see the Models page). A 100 requests per day cap for DeepSeek-R1 and V3 applies to users who have not completed identity verification | UNKNOWN beyond that | UNKNOWN (the page lists RPD/TPD limits but no reset time) | UNKNOWN | https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation |
| **ModelScope** (`modelscope`) | UNKNOWN: the page I fetched had only a title | UNKNOWN | UNKNOWN | UNKNOWN | https://modelscope.cn/docs/model-service/API-Inference/intro (empty result) |
| **Gitee AI** (`gitee-ai`) | UNKNOWN: the docs moved to https://moark.com/docs/openapi/v1 and I did not read it | UNKNOWN | UNKNOWN | UNKNOWN | not read |
| **NVIDIA** (`nvidia`) | UNKNOWN: both pages I tried returned nothing usable (404 and empty). The public model list has no price or free flag | UNKNOWN | UNKNOWN | none | https://integrate.api.nvidia.com/v1/models (33 models, id only) |
| **Mistral** (`mistral`) | Not confirmed. The pricing page covers consumer plans ("Free plan: limited access to Vibe", Studio access) and API prices, with no API free tier stated. Whether an API free tier exists today is UNKNOWN | UNKNOWN | UNKNOWN | none (model list needs a key) | https://mistral.ai/pricing ; the docs tier page returned 404 |
| **Together AI** (`together`) | One model priced free on the pricing page: Ternary Bonsai 27B. The pages mention free models and per-minute limits but give no numbers; free credits UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN (list needs a key) | https://www.together.ai/pricing ; https://docs.together.ai/docs/rate-limits |
| **Fireworks** (`fireworks`) | No free tier or free credits stated. Accounts with no payment method or no credits are limited to 10 requests per minute; with a card and credits, 6,000 | 10 RPM without a card | n/a (a rate limit, not a daily quota) | none | https://docs.fireworks.ai/guides/quotas_usage/rate-limits |
| **xAI** (`xai`) | No free credits or free tier on the pages read (pricing and rate-limit tiers). Tier 0 is $0 spend, the default; limits are per-second and per-minute, no daily quota | per-model RPS/TPM by tier | rate-based | none | https://docs.x.ai/docs/key-information/consumption-and-rate-limits |
| **DeepSeek** (`deepseek`) | No free allowance on the pricing page. It mentions a "granted balance" used before top-ups (what grants it: UNKNOWN) | n/a | n/a | none | https://api-docs.deepseek.com/quick_start/pricing |
| **OpenAI** (`openai`) | No free API tier on the pricing page. Only moderation (`omni-moderation-latest`) is free; 1 GB free file-search storage. No data-sharing free-token programme mentioned | n/a | n/a | none | https://developers.openai.com/api/docs/pricing |
| **Anthropic** (`anthropic`) | No free tier or free credit on the rate-limits page. New organizations may start in an "Evaluation" tier with lower limits | n/a (RPM/ITPM/OTPM, token bucket; the monthly spend cap resets 00:00 UTC on the 1st) | not a free allowance | none | https://platform.claude.com/docs/en/api/rate-limits |
| **Ollama** (`ollama`) | Local models cost nothing (they run on the person's own computer). Ollama's cloud models need an account; free-plan limits and reset are UNKNOWN (the docs point to ollama.com/pricing, which I did not read) | local: no cost; cloud: UNKNOWN | UNKNOWN | the local list has no price; treat local as free by provider kind, not by flag | https://docs.ollama.com/cloud ; https://docs.ollama.com/cloud/usage.md |

## Summary for the Builder

1. **Daily-reset free models, confirmed:** OpenRouter (`:free`, 50 or 1000 requests per UTC day, 20 per minute); Google Gemini (RPD resets at midnight Pacific; per-model numbers must be re-read); OpenCode Zen (LongCat 2.5 Free 100 per day; the other free models have no stated daily cap, and each is free for a limited time). Cerebras refills continuously; Groq's daily limit exists (the header says so) but its Free numbers are UNKNOWN.
2. **Monthly or one-off:** Vercel (monthly credit), GitHub Copilot Free (2,000 completions per month plus AI credits), Alibaba (1M tokens per model, 90 days, no reset), Cerebras (30-day $5 trial).
3. **Free by price only (no stated cap):** Zhipu GLM Flash models (three), Together's one free model.
4. **No free allowance found:** Anthropic, OpenAI, DeepSeek, xAI, Fireworks (10 RPM with no card), Moonshot.
5. **UNKNOWN, needs a person with a key or a re-read:** Groq Free numbers, Mistral, Together, NVIDIA, SiliconFlow free models, ModelScope, Gitee AI, OpenCode Go, Ollama cloud.
6. **GitHub Models is gone** (retired 2026-07-30). Nothing in Bunny should promise it as free.
7. **Only one rule is safe to show as "free" per model today:** a model whose list entry says zero cost. "Free daily allowance" is a provider-level property with its own limits; the UI should say "free, limited" and link the limit, not mark every model of Google or Groq as free.
8. Suggested data shape: a small table in the catalog, per provider `{ freeAllowance: 'daily'|'monthly'|'once'|'none'|'unknown', note, url, checked }`, and `isFree` extended for `cost` and `pricing.input/output` as above. Limits change; store the checked date and re-check each release.

## Not verified

- I read pages through a summarising fetch tool, not by eye; the Google numbers in particular look odd and may be mis-summarised.
- No account was created and no key used, so nothing here was tested by calling a free model.
- Groq, Together and Mistral model lists need a key; their free flags are unchecked.
