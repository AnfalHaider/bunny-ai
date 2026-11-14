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
