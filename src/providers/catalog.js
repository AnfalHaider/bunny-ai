/**
 * Provider catalogue for Bunny AI.
 *
 * Pure data: what a provider is called, how you authenticate to it, and which
 * fields the connect form must collect. No I/O, no secrets, no network.
 *
 * `kind` decides the connect flow:
 *   apiKey  - user pastes a key (optionally overrides a base URL)
 *   oauth   - browser/device-code handshake; no secret typed by the user
 *   local   - a server on this machine or LAN; no key required
 */

/** @typedef {'apiKey'|'oauth'|'local'} ProviderKind */

export const KINDS = /** @type {const} */ (['apiKey', 'oauth', 'local']);

/** @typedef {'coding'|'reasoning'|'vision'|'long-context'|'tool-use'|'cheap-fast'|'local-offline'} Ability */

/** @type {ReadonlyArray<{
 *   id: string,
 *   name: string,
 *   tagline: string,
 *   kind: ProviderKind,
 *   recommended?: boolean,
 *   defaultBaseUrl?: string,
 *   keyHint?: string,
 *   docsUrl?: string,
 *   abilities?: Ability[]
 * }>} */
export const PROVIDERS = Object.freeze([
  {
    id: 'nvidia',
    name: 'Nvidia',
    tagline: 'NVIDIA NIM models served from build.nvidia.com',
    kind: 'apiKey',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    keyHint: 'nvapi-...',
    docsUrl: 'https://build.nvidia.com',
    abilities: ['coding', 'reasoning', 'long-context', 'tool-use'],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    tagline: 'Low cost subscription for everyone',
    kind: 'oauth',
    recommended: true,
    oauth: {
      clientId: 'bunny-ai',
      deviceCodeUrl: 'https://opencode.ai/auth/device/code',
      tokenUrl: 'https://opencode.ai/auth/device/token',
      verificationUri: 'https://opencode.ai/auth/device',
      scopes: 'models:read chats:read',
      baseUrl: 'https://opencode.ai/go/v1',
    },
    abilities: ['coding', 'reasoning', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'opencode-console',
    name: 'OpenCode Console',
    tagline: 'Curated models from Anthropic, OpenAI, Google and more',
    kind: 'apiKey',
    recommended: true,
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use', 'long-context'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    tagline: 'Direct access to Anthropic models via API key',
    kind: 'apiKey',
    // Anthropic speaks the OpenAI shape at /v1/chat/completions, but its model
    // list is the native one and wants the key in x-api-key.
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    auth: { header: 'x-api-key', extra: { 'anthropic-version': '2023-06-01' } },
    keyHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use', 'long-context'],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    tagline: 'AI models for coding assistance via GitHub Copilot',
    kind: 'oauth',
    oauth: {
      clientId: 'Iv1.b507a08c87ecfe98',
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      verificationUri: 'https://github.com/login/device',
      scopes: 'read:user',
      baseUrl: 'https://api.githubcopilot.com',
    },
    abilities: ['coding', 'tool-use'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'GPT models for fast, capable general AI tasks',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'google',
    name: 'Google',
    tagline: 'Gemini models for fast, structured responses',
    kind: 'apiKey',
    // Gemini's OpenAI-compatible API lives under /openai; the native one
    // wants the key in x-goog-api-key.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
    abilities: ['coding', 'reasoning', 'vision', 'long-context', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Access all supported models from one provider',
    kind: 'apiKey',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use', 'long-context', 'cheap-fast'],
  },
  {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    tagline: 'Unified access to AI models with smart routing',
    kind: 'apiKey',
    defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1',
    docsUrl: 'https://vercel.com/docs/ai-gateway',
    abilities: ['coding', 'reasoning', 'tool-use', 'cheap-fast'],
  },
  // OpenAI-compatible providers people ask for by name. Each speaks the same
  // /chat/completions and /models shape, so only the address and key differ.
  {
    id: 'modelscope',
    name: 'ModelScope',
    tagline: 'Open models (Qwen, DeepSeek and more) with a free daily quota',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api-inference.modelscope.cn/v1',
    keyHint: 'ms-...',
    docsUrl: 'https://modelscope.cn/my/myaccesstoken',
    abilities: ['coding', 'reasoning', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    tagline: 'Fast open models; use api.siliconflow.com outside China',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    keyHint: 'sk-...',
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'gitee-ai',
    name: 'Gitee AI',
    tagline: 'Model serving from Gitee (Moark)',
    kind: 'apiKey',
    defaultBaseUrl: 'https://ai.gitee.com/v1',
    docsUrl: 'https://ai.gitee.com/dashboard/settings/tokens',
    abilities: ['coding', 'reasoning', 'tool-use'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: 'DeepSeek chat and reasoning models, direct',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    abilities: ['coding', 'reasoning', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    tagline: 'Kimi models; use api.moonshot.cn inside China',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.moonshot.ai/console/api-keys',
    abilities: ['coding', 'reasoning', 'long-context', 'tool-use'],
  },
  {
    id: 'zhipu',
    name: 'Zhipu (GLM)',
    tagline: 'GLM models from Zhipu AI',
    kind: 'apiKey',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use'],
  },
  {
    id: 'dashscope',
    name: 'Alibaba Cloud (Qwen)',
    tagline: 'Qwen models from Model Studio; use dashscope.aliyuncs.com inside China',
    kind: 'apiKey',
    defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyHint: 'sk-...',
    docsUrl: 'https://modelstudio.console.alibabacloud.com',
    abilities: ['coding', 'reasoning', 'vision', 'long-context', 'tool-use'],
  },
  {
    id: 'groq',
    name: 'Groq',
    tagline: 'Very fast open models',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_...',
    docsUrl: 'https://console.groq.com/keys',
    abilities: ['coding', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'together',
    name: 'Together AI',
    tagline: 'Hundreds of open models',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://api.together.ai/settings/api-keys',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    tagline: 'Mistral and Codestral models, direct',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://console.mistral.ai/api-keys',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use'],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    tagline: 'Grok models, direct',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.x.ai/v1',
    keyHint: 'xai-...',
    docsUrl: 'https://console.x.ai',
    abilities: ['coding', 'reasoning', 'vision', 'tool-use', 'long-context'],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    tagline: 'Fast hosted open models',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    keyHint: 'fw_...',
    docsUrl: 'https://fireworks.ai/account/api-keys',
    abilities: ['coding', 'reasoning', 'tool-use'],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    tagline: 'Open models at very high speed',
    kind: 'apiKey',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    keyHint: 'csk-...',
    docsUrl: 'https://cloud.cerebras.ai',
    abilities: ['coding', 'tool-use', 'cheap-fast'],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    tagline: 'Run open models on your own machine, no key needed',
    kind: 'local',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    docsUrl: 'https://ollama.com',
    abilities: ['coding', 'reasoning', 'local-offline', 'tool-use'],
  },
]);

/** @param {string} id */
export function findProvider(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Fields the connect form must render for a provider. */
export function fieldsFor(provider) {
  switch (provider.kind) {
    case 'apiKey':
      return [
        { name: 'apiKey', label: 'API key', type: 'secret', required: true, hint: provider.keyHint },
        { name: 'baseUrl', label: 'Base URL', type: 'url', required: false, hint: provider.defaultBaseUrl },
      ];
    case 'local':
      return [
        { name: 'baseUrl', label: 'Server URL', type: 'url', required: true, hint: provider.defaultBaseUrl },
      ];
    case 'oauth':
      return [];
  }
}
