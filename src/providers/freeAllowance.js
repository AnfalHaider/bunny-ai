/**
 * Free allowances per provider, from the research note
 * docs/research/2026-11-17-free-daily-allowances.md (checked 2026-11-17).
 *
 * Pure data. A provider's kind says what its free plan is:
 *   daily       - resets each day; the only kind that earns the "Free daily" tag
 *   monthly     - a monthly allowance
 *   once        - a one-off grant that never resets
 *   priced-zero - some models are priced at zero; no allowance stated
 *   none        - no free allowance found
 *   unknown     - not checked; a model is "free" only from its own zero-cost list entry
 *
 * Limits change. Re-read each URL before a release and bump `checked`.
 */

/** @typedef {'daily'|'monthly'|'once'|'priced-zero'|'none'|'unknown'} FreeKind */

/** @type {Readonly<Record<string, { kind: FreeKind, note: string, url: string, checked: string }>>} */
export const FREE_ALLOWANCE = Object.freeze({
  openrouter: {
    kind: 'daily',
    note: 'Models with the :free suffix. 20 requests per minute; 50 requests per day, or 1000 per day after at least 10 credits bought. Resets per UTC day.',
    url: 'https://openrouter.ai/docs/api-reference/limits',
    checked: '2026-11-17',
  },
  google: {
    kind: 'daily',
    note: 'Free tier on some models. Limits vary by model and account, per project. Requests per day reset at midnight Pacific time. Numbers not re-checked: read the limits page before quoting them.',
    url: 'https://aistudio.google.com/docs/rate-limits',
    checked: '2026-11-17',
  },
  cerebras: {
    kind: 'once',
    note: 'Free trial: $5 credits that expire 30 days after grant, then limits. The page lists 1M tokens per day on gpt-oss-120b, and a token bucket that refills continuously (no fixed reset). The research note is not consistent on the reset; re-read the page.',
    url: 'https://inference-docs.cerebras.ai/support/rate-limits',
    checked: '2026-11-17',
  },
  'opencode-console': {
    kind: 'unknown',
    note: 'not checked: some models are free for a limited time, and no reset is stated. Only LongCat 2.5 Free has a stated cap (100 requests per day). Not tagged as a daily allowance.',
    url: 'https://opencode.ai/docs/zen/',
    checked: '2026-11-17',
  },
  'opencode-go': {
    kind: 'unknown',
    note: 'not checked: no free plan found; a subscription with included usage. Price and usage windows not checked.',
    url: 'https://opencode.ai/docs/zen/',
    checked: '2026-11-17',
  },
  vercel: {
    kind: 'monthly',
    note: 'Monthly free credit on a subset of models, ending once credits are purchased. Amount and exact reset day not stated.',
    url: 'https://vercel.com/docs/ai-gateway/pricing',
    checked: '2026-11-17',
  },
  'github-copilot': {
    kind: 'monthly',
    note: 'Copilot Free plan: 2,000 completions per month plus an AI credits allowance (amount not stated). GitHub Models, the free API, was retired on 2026-07-30.',
    url: 'https://docs.github.com/en/copilot/get-started/plans',
    checked: '2026-11-17',
  },
  dashscope: {
    kind: 'once',
    note: 'One-off quota of 1,000,000 tokens per eligible Singapore model, valid 90 days from activation. Never resets.',
    url: 'https://www.alibabacloud.com/help/en/model-studio/new-free-quota',
    checked: '2026-11-17',
  },
  zhipu: {
    kind: 'priced-zero',
    note: 'Three models priced free (GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash). No usage cap stated; not checked beyond that.',
    url: 'https://docs.z.ai/guides/overview/pricing',
    checked: '2026-11-17',
  },
  together: {
    kind: 'priced-zero',
    note: 'One model priced free (Ternary Bonsai 27B). Free credits and limits not stated.',
    url: 'https://www.together.ai/pricing',
    checked: '2026-11-17',
  },
  anthropic: {
    kind: 'none',
    note: 'No free tier or free credit on the rate-limits page. New organisations may start on a lower Evaluation tier.',
    url: 'https://platform.claude.com/docs/en/api/rate-limits',
    checked: '2026-11-17',
  },
  openai: {
    kind: 'none',
    note: 'No free API tier on the pricing page. Only moderation is free.',
    url: 'https://developers.openai.com/api/docs/pricing',
    checked: '2026-11-17',
  },
  deepseek: {
    kind: 'none',
    note: 'No free allowance on the pricing page (a granted balance is used before top-ups; what grants it is not stated).',
    url: 'https://api-docs.deepseek.com/quick_start/pricing',
    checked: '2026-11-17',
  },
  xai: {
    kind: 'none',
    note: 'No free credits or free tier on the pages read. Limits are per-second and per-minute, with no daily quota.',
    url: 'https://docs.x.ai/docs/key-information/consumption-and-rate-limits',
    checked: '2026-11-17',
  },
  fireworks: {
    kind: 'none',
    note: 'No free tier or free credits stated. Without a payment method or credits: 10 requests per minute (a rate limit, not a daily quota).',
    url: 'https://docs.fireworks.ai/guides/quotas_usage/rate-limits',
    checked: '2026-11-17',
  },
  moonshot: {
    kind: 'none',
    note: 'No free allowance found; a $1 minimum recharge is needed. Tier 0 limits not checked.',
    url: 'https://platform.kimi.ai/docs/pricing/limits',
    checked: '2026-11-17',
  },
  groq: {
    kind: 'unknown',
    note: 'not checked: the Free plan numbers could not be told apart from the other tables. A daily limit exists per response headers.',
    url: 'https://console.groq.com/docs/rate-limits',
    checked: '2026-11-17',
  },
  mistral: {
    kind: 'unknown',
    note: 'not checked: no API free tier confirmed on the pricing page; the docs tier page returned 404.',
    url: 'https://mistral.ai/pricing',
    checked: '2026-11-17',
  },
  nvidia: {
    kind: 'unknown',
    note: 'not checked: the public model list has no price or free flag, and the docs pages returned nothing usable.',
    url: 'https://integrate.api.nvidia.com/v1/models',
    checked: '2026-11-17',
  },
  siliconflow: {
    kind: 'unknown',
    note: 'not checked: some models are free with fixed rate limits, but which models and limits were not confirmed. 100 requests per day cap on DeepSeek-R1 and V3 without identity verification.',
    url: 'https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation',
    checked: '2026-11-17',
  },
  modelscope: {
    kind: 'unknown',
    note: 'not checked: the page fetched had only a title.',
    url: 'https://modelscope.cn/docs/model-service/API-Inference/intro',
    checked: '2026-11-17',
  },
  'gitee-ai': {
    kind: 'unknown',
    note: 'not checked: the docs moved and were not read.',
    url: 'https://moark.com/docs/openapi/v1',
    checked: '2026-11-17',
  },
  'bunny-local': {
    kind: 'priced-zero',
    note: 'models Bunny downloads and runs on the person\'s own computer: nothing is billed.',
    url: 'https://github.com/ggml-org/llama.cpp',
    checked: '2026-11-17',
  },
  ollama: {
    kind: 'unknown',
    note: 'not checked: local models cost nothing on the person\'s own computer; Ollama cloud free-plan limits not checked.',
    url: 'https://docs.ollama.com/cloud',
    checked: '2026-11-17',
  },
});

/**
 * The tag a model earns from its provider's free plan.
 * `isFreeModel` is the model's own verdict (its list entry, see isFree in discovery.js).
 *
 * @param {string} providerId
 * @param {boolean} isFreeModel
 * @returns {'daily'|'free'|null}
 */
export function freeKindOf(providerId, isFreeModel) {
  if (!isFreeModel) return null;
  return FREE_ALLOWANCE[providerId]?.kind === 'daily' ? 'daily' : 'free';
}
